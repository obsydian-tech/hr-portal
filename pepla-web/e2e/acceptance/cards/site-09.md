# SITE-09

Card: SITE-09 Learn more page: Recruitment (NH-214, epic NH-202)

Test files: `site-09.spec.ts`, `support/site-09/page.ts` (the Recruitment page's own checks), `support/site-09/build.ts` (the production build and a static server for it), `support/site-09/files.ts` (the AC-12 file rule).

Spec: [NH-214](https://obsydian.atlassian.net/browse/NH-214)

Locks: acceptance-lock/site-09

It imports, and never edits, `support/site-08/learn-page.ts` and `support/site-08/kit.ts` (SITE-08, NH-213: the page helper and the kit oracle) and `support/site-01/public-site.ts` (the Cognito and API patterns of SITE-01). It needs SITE-08 merged: without `support/site-08/` the spec does not load.

## How the tests run

```
E2E_BASE_URL=http://localhost:4200 npx playwright test -c e2e/acceptance/playwright.config.ts site-09
```

Every test runs at 1280 and 390 wide, except AC-3 (1440 and 390: the kit's desktop screen is 1440) and AC-12 (reads the repository and the build once, in `desktop-1280`). The browser starts with `--disable-lcd-text --font-render-hinting=none`. The build (`npm run build`, which runs `verify:design` first and `verify-public-names` last) runs once per test run, in AC-1, and AC-2 and AC-12 read the same output (a few minutes). `SITE_09_BUILD_DIR` points the tests at an existing build output instead (for trying a changed output by hand; CI does not set it).

### The kit ref

The kit is the oracle: its markup (`project/ui_kits/site-pages.html`, screen "Recruitment page") and its preview scripts (`site-pages.js`, `site-demos.js`, `site-recruitment.js`, `site-page-heroes.js`) are fetched from the design system at the ref in `SITE_09_KIT_REF`, else `dee75b046aa8330912e1fd5f5c6ee072c736997a` (design system PR #54, 18 Nov: the two Recruitment claims are removed from the kit; the scripts are the same as at dc593c4, the pin before), and cached in the temp folder. The spec sets `SITE_KIT_REF` to it for its own tests only (and puts the old value back afterwards, so no other spec in the run is changed). Why not the SITE-08 helper's default, the ref in `sync.json`: that is e9a352f today, and e9a352f

- has the closing band note ("Get started creates a company account. ...") that SITE-08 removes from the app (DS #47, merged as 8dc3091), so the closing band would differ from the kit, and
- has the scripts from before DS #49 (c3788a5, demos keep playing under reduced motion). For the Recruitment page nothing changes (`site-recruitment.js` did not change between c0de954 and dee75b0: its only reduced motion rule is that the flying board card stops), but the ref must not be older than c3788a5 for the rule to be the kit's.

Any ref from 8dc3091 on works for this page; the design system CSS the app serves (`src/styles/design-system/`) must be the same or newer in the classes the page uses (e9a352f, dc593c4 and dee75b0 have the same `site.css`).

## Contract (what the builder makes)

1. Route `/product/recruitment`, lazy, in `site.routes.ts` (`canActivate: [siteStyles]`, title "Naleko People"), and `{ path: 'product/recruitment', renderMode: RenderMode.Prerender }` in `app.routes.server.ts`. The page lives in `src/app/ds/site/learn/recruitment/` (at least one `.ts` file that is not a spec).
2. The page is one `h1`, one `main`, the header and the footer. A `.pp-site-form-page--learn` hero (the Learn more page top) is a child of the one element that also holds the sub-menu, the demos, the ending and the closing band (the SITE-08 helper takes its root from it: `.pp-site-form-page--learn`'s parent). The footer may sit in that element or outside it (it is judged by its own check).
3. Section ids exactly: `hiring-board`, `panels`, `follow-ups`, `risk`, `questions` and the closing band `demo`, each once, each element named by a heading inside it through `aria-labelledby`. Sub-menu tabs in that order with those names and `#` targets.
4. The hero card is `.pp-site-hcard[data-demo="hcard-recruitment"]`. The demos are `section.pp-site-demo` with the kit's classes (`pp-site-board__*`, `pp-site-score__*`, `pp-site-timeline__*`, `pp-site-risk__*`, `pp-site-state__item--on`, `pp-site-step--in`, `pp-site-demo__again`), `data-site-live` once started and a `button.pp-site-demo__again`.
5. A demo starts when 15% to 60% of it is in view (the kit starts at 30% for the board and 35% for the others; the spec says 15%; the tests judge "not at 6%, started at 60%"). Once started it plays once, keeps its place and replays from its first step with Play again, which keeps focus.
6. `data-site-still` on the `html` element: every demo and the hero card show their last step at once, nothing loops. Under `prefers-reduced-motion: reduce` the demos keep their timings; the flying card (the board's `element.animate` of `transform`) and the other large movements stop (the kit page has no grain).
7. Links with `href="#"` do not matter to these tests (the spec leaves link targets to SITE-16).

## What each test judges

- AC-1 `GET /product/recruitment` is 200 with no redirect (`maxRedirects: 0`) and the address stays; `document.title` is "Naleko People"; one `h1`; no request to Cognito or the employees and document APIs (they are refused and counted); `site.css` is requested once and linked once; no signed-in marker in any loaded script; `/`, `/nothing-here` and `/sign-in` still show what they showed. The production build holds `product/recruitment/index.html` (or `.html`) with the tab title, a `header`, exactly one `main`, and every `h1` and `h2` of the kit page in its text; served as static files (a small server with no fallback to the app shell, 404 for an unknown path) with JavaScript off, the header, one `main`, one `h1` and every heading of the kit screen are visible.
- AC-2 the page's words and accessible names equal the kit screen's, both ways: the SITE-08 helper's `checkPageWords` on the page's own box, and the same set check on the whole page and the whole kit screen (header, page, footer; the phone sheet is left out on both sides). None of the removed sentences (see "Child lock .3") is on the page or in the prerendered file, and the hero lead is the kit's shorter one. No `lorem`, `placeholder`, `masked`, `claude` or `pepla` in the rendered page's text, attributes, classes, `href`s or title, nor in the prerendered file.
- AC-3 at 1440 and 390 with motion frozen and the views frozen: the helper's `checkPageParity` (every kit item in order, each box within 1px), then at most 1% of pixels differ over the whole page and over the footer (own pixel check: a real page is not in a `.pp-site-stage`, which the SITE-08 pixel path needs; the page is taken in 2400px slices, pixels count as in SITE-08: a channel difference over 24 against the other page's pixel and its neighbours above and below).
- AC-4 the helper's `checkTop` (breadcrumb, `h1` with its shine line, buttons, pills, rings turning on the compositor, nothing under the header on a phone), and the hero card: with both views fired, the card's states (classes, text, `--_fill` and `--_p`, every 20ms) run through the same sequence as the kit's preview script, each within 250ms, for 15.5s (the whole loop and the return to the first step); its box height never changes while it loops; under `data-site-still` it shows the state the kit holds between its last step and its restart, and does not move on.
- AC-5 the helper's `checkSubmenu` and `checkSections`; the five tabs literally as listed (no "Offer to onboarding"), and the same pills as the kit's; the ids once each with a heading inside each section naming it; the kit's order of top, sub-menu, four demos, Ask Batsi, strip, related, questions, closing band and footer.
- AC-6 to AC-9 per demo, through `checkDemo`: (a) the run, with both views fired together: the states in the same order, each within 250ms of the kit's; (b) the last step: every box of the section within 1px and at most 1% of pixels different; (c) what the demo says at the end, spelled out (the six columns, their counts 2, 0, 3, 0, 1, 2, the three reasons and the log line; every score in, the average, Jane Smith's move; the five timeline items and the reminder; three flags, the suggestion, the signed offer, "2 flagged"); (d) Play again by click: the first step, 280ms later, as the kit draws it (boxes and pixels; the pages are photographed one after the other, so every pending timer on both is cleared at the 280ms mark and what is compared is the state both were in then; this is the last thing the test does to the page); (e) Play again by Enter: the run again within 250ms, from the first step, with focus still on the button, a `button`; (f) by hand: "Move to Offer" pressed 3s into the panels run does what the kit does; (g) the start: with the real view observer and 3000px of spacer from the first paint, not started with 6% of it in view (the kit neither), started with 60%. Board only: the words and the list side by side from 1024 (the list under the words on a phone), the board below them at their full width.
- AC-11 the helper's `checkMotion` (only `transform` and `opacity` animate, no inline `width`, `height`, `left`, `top`, `inset`, `margin` or `padding`, reduced motion still steps, `data-site-still` shows every step and stops every loop); the board flight: in normal motion the kit and the page fly the same cards, each for the kit's time within 100ms (the control: the probe sees a flight), under reduced motion neither flies one and the board still plays at the kit's timings; under reduced motion all four demos still play at the kit's timings (design system #49: only the flying card stops), and under `data-site-still` every demo shows the end state of its run (the same facts AC-6 to AC-9 read after the run); no sideways scroll at both widths; at 390 every heading and button of the page is visible, inside the window and not under the header or the sub-menu when scrolled to just below them; one `h1`; axe (wcag2a, wcag2aa) with every demo on its first step and one question open, and with every demo on its last step and one question open.
- AC-12 the file rule on tables (14 accepted and 20 refused paths, among them `app.routes.ts`, `ds/README.md` and `site.css`, which this card does not change), the state of the repository (the page's folder holds a `.ts` that is not a spec; `site.routes.ts` and `app.routes.server.ts` hold the route and the prerender entry, read with their comments taken out), `/sign-in` and `/hr` load no script with `pp-site-`, `ppSite`, `PpSite` or `DemoClock`, `verify-public-names` passes on the build and the build holds the page, then the file rule on the change: the base is the merge-base of HEAD with `origin/develop` (else `develop`; in CI the merge commit's first parent), `git diff --name-only --no-renames`, every file must match the anchored allow-list below. The file rule alone is skipped when a pull request changes none of this card's files (`ds/site/learn/recruitment/`, the SITE-09 test files): another card's pull request has nothing to judge here. The repository-state checks have no skip, so develop fails them.

### The allow-list

- `src/app/ds/site/**`, `src/app/features/public/**`
- `src/app/site.routes.ts`, `src/app/app.routes.server.ts`
- `e2e/acceptance/site-NN.spec.ts`, `e2e/acceptance/cards/site-NN.md`, `e2e/acceptance/support/site-NN/**` (NN two digits, so the other site cards' tests are let through)

Refused outright: `src/app/ds/all.ts` and `src/app/features/` outside `features/public/`.

The allow-lists of the locked SITE-03 and SITE-04 AC-12 are widened to `site-\d{2}` by SITE-07 (see its card); SITE-09 needs nothing more from them.

Tolerances: boxes 1px; pixels 1% (channel difference over 24); timing 250ms; states shorter than 45ms are not compared; the sampler runs every 20ms.

## Where the card and the tests differ

- AC-5 runs SITE-08's `checkSubmenu` with `deaf: true` (demos stay on their first step): the tap check scrolls smoothly past all four demos on two live pages, and on a busy machine the scroll can start later than the kit script's 180ms settle, which ends the page somewhere else. The sub-menu does not depend on the demos.
- AC-11 runs `checkMotion` on a page whose open step switches off the transition of the phone header's menu button (`.pp-site-header__burger`, the shared header). SITE-08's colour allowance names `pp-button` as the first class and the burger's first class is its own, so the helper counts the burger's `background-color` transition as a problem. Open question for the SITE-08 owner: widen the allowance.
- Each picture of a region counts only when the region sat still before and after it (a demo elsewhere on the page can change height while the pictures are taken).
- Pixel checks photograph both pages scrolled to the top, so the sticky header and sub-menu sit over the hero and not over the region compared.
- The kit's Recruitment page has no hero grain, so there is no grain check (the other large movements are covered by SITE-08's `checkMotion`).
- The board flight probe counts only `element.animate` on the card element itself (the flying card), not CSS animations of its parts (the reason line of the log slides in with CSS).
- Start threshold: the card says 15%, the kit starts at 30% (board) and 35%. The tests judge "not started at 6%, started at 60%", so any threshold from 15% to 60% passes (as SITE-08).
- AC-3 desktop is read in a 1440 window (the kit's desktop screen); the other desktop checks use the project's 1280 window, where the kit page's stage takes the window's width too.
- The footer sits outside the helper's page box on a build that uses `PpSitePage` (the footer is projected after `main`), and inside the kit's. So the helper's whole-page checks leave it out on both sides (`omit`), and the footer has its own words, box and pixel checks.
- AC-11 "tilt" (pointer tilt) is not tested: the kit's Recruitment page has none.
- The hero card's last step under `data-site-still` is read from the kit's own run (its state between the last step at 8.7s and the restart at 13.7s), since the kit's script shows the first step, not the last, under `data-site-still`.
- Link targets ("Book a demo", "Get started", "Learn more") are not judged (SITE-16).

## Child lock .1: fonts before every region compare

`compareRegion` (the parity of every region and demo step) first calls `fontsAndResize`: both pages wait for `document.fonts.ready` and get a `resize` event, then 150 ms, before the pages settle and compare. Found on CI: the kit's sub-menu pill was 119px wide against 115px on the page, because the kit script measures before the web font loads (the same fault as SITE-08 child lock .1). No tolerance changed. The step is exported so later Learn more cards use it.

## Child lock .2: tab title and the two public claims (18 Nov)

Iggie chose "all recommended" on the site wording cards: the tab title is the page name, a middle dot, then the brand: `Recruitment · Naleko People` (the page name is the kit's breadcrumb current item). AC-1 and the banned-words read pin this exact title, in the live page and in the prerendered file. The two public claims on this page ("A person makes every hire or reject decision" and "A signed offer starts onboarding with no retyping") were to be hidden until the code behind them is built; child lock .3 (below) pins their removal from the kit.

## Child lock .3: the two claims are removed from the kit (18 Nov)

Child lock .2 pinned the tab title and left the two public claims of this page for a separate lock, "to be hidden until the code behind them is built". The design system has now done it by removing them from the kit (PR #54, dee75b0). Iggie approved the removal and no new wording was written. The kit is the oracle, so the tests pin the removal, both ways: the page does not hold what the kit no longer holds, and nothing was added.

What changed in the kit between dc593c4 and dee75b0 (the scripts are the same; `project/ui_kits/site-pages.html`, `site-page-heroes.html` and `components/site/site-hcard.examples.html`, `site-strip.examples.html`):

- The hero lead loses ", and a signed offer starts onboarding with no retyping": it ends "Panels score candidates against the same criteria, and Batsi watches each stage for candidates who go quiet."
- The Offer demo section (`offer`, `data-demo="offer"`, the "Offer to onboarding" demo with its panel) is gone, with its sub-menu pill "Offer to onboarding" and the link "Learn more about Onboarding and Offboarding" under it. The page has four demos and five pills.
- The trust strip item "A person makes every hiring decision" is gone: the strip has three items (the other module pages keep theirs). The tile line "Accepted offers start onboarding with no retyping." is gone from the Onboarding page ending (SITE-10).

What the tests check (support/site-09/page.ts, `removalFacts`, `removalProblems`, `removedIn`, `offerMarkupIn`; spec AC-2, AC-5, AC-11, the Plants test):

- AC-2: none of the removed sentences is in the page's markup (text and attributes) or in the prerendered file; the hero lead is the new one in the live page (exactly) and in the prerendered file; no Offer demo markup in the prerendered file (`data-demo="offer"`, an id `offer`, a link to `#offer`, `pp-site-offer__` classes). The kit screen is read too, so a kit ref from before DS #54 fails loudly.
- AC-5: the page has the kit's five pills (text and target, in order, none for the Offer demo), the kit's four demo sections, no section with `data-demo="offer"` or an id starting `offer`, no link to it or under it, and the kit's three trust strip items. AC-6 to AC-9 are the four remaining demos (the Offer demo and its timeline and engine checks are gone: no test expects it). AC-11 runs the four.
- Plants: the removal check is run on the live page with one removed item put back, in turn: the hero clause, the strip item, the Offer demo section, the sub-menu link, the link under the demo. Each must fail and name the item; the page as it is passes. The prerendered file's check is run on a stand-in file with each removed sentence added (also with a comment between its words) and each piece of Offer demo markup.

Each removed sentence is matched without regard to case, white space or comments between its words. A page that brings a claim back with new wording is not caught by the sentences; it is caught by the kit's word, section and strip equality.
