# SITE-08

Card: SITE-08 Learn more page frame (NH-213, epic NH-202)

Test files: `site-08.spec.ts`, `support/site-08/kit.ts`, `support/site-08/learn-page.ts` (the page helper SITE-09 to SITE-14 reuse), `support/site-08/reduced-motion.ts` (child lock .2: timers, CSS loops and pointer moves under reduced motion), `support/site-08/files.ts` (the AC-11 file rule).

Spec: [NH-213](https://obsydian.atlassian.net/browse/NH-213)

Locks: acceptance-lock/site-08, acceptance-lock/site-08.1 (fonts before parity), acceptance-lock/site-08.2 (reduced motion keeps the demos playing), acceptance-lock/site-08.4 (fonts before every compare)

It builds on `cards/site-03.md` and `cards/site-04.md` (same `window.__ppSiteClock` hook, same kit oracle, same parity method).

## How the tests run

All tests run at 1280 and 390 wide, except AC-9 and AC-11, which read files and run the SSR spec, so they run once, in `desktop-1280` (the `phone-390` run is skipped). The desktop device is read in a 1456 wide window (stage 1440), the phone at 390. The browser starts with `--disable-lcd-text --font-render-hinting=none`.

The kit is the oracle. The tests fetch it from `obsydian-tech/pepla-design-system` at the ref in `SITE_KIT_REF`, else the pinned default `03df8e2aa41ed09dc7a1571f074b3d8c82ffde9a` (`SITE_KIT_REF` in `support/site-08/kit.ts`: the design system main head of 17 Nov, which holds PR #47, #49, #50, #51; since child lock .2 the default no longer follows `sync.json`), and cache it under the temp folder. The kit page is served from the app's own origin under `/__site-08-kit__/`, with `ds/index.css` from the local DS folder. The ref must hold `project/ui_kits/site-pages.html` and `site-pages.js` (the pinned ref does, as does c0de954c2b1d60f5b65d894a2664cfa6ffeda2d0; a ref without them stops the tests with an error that names `SITE_KIT_REF`). The CSS is the app's own synced `src/styles/design-system` on both pages (its `site.css` equals the one at the pinned ref today); a sync of the DS belongs to the builder's PR.

```
# SITE_KIT_REF=<ref> overrides the pinned kit ref (SITE-09 sets it for its own tests and puts it back)
E2E_BASE_URL=http://localhost:4200 npx playwright test -c e2e/acceptance/playwright.config.ts site-08
```

## Contract (what the builder makes)

1. Gallery. Dev only, route `/dev/site-learn` (not reachable in a production build, as the other `/dev` pages). Each example is `section[data-example][id]` holding one `[data-example-body]`, which holds one `.pp-site-stage` (class `pp-site-stage--phone` on the phone width, `data-theme="light"`). `data-example` is `<Name> (<device>)` and `id` is `learn-<kebab name>-<device>`, except when the name already starts with "learn" (then no second `learn-`). Device is `desktop` or `phone`; the gallery shows both sizes (a 1440 wide stage, a 390 wide stage).
2. The examples (names are the kit's screen names; the kit files are `project/ui_kits/site-pages.html`'s screens and the three screen lists the tests read: demos, heroes, endings):
   - demo section: white, and cream and flipped (phone has one).
   - Questions.
   - Ask Batsi: first question answered, waiting for a person, approved and logged.
   - Learn more top: Recruitment, Onboarding, Compliance, Leave, Security, Platform. The page-top hero card is not compared, on either side: the gallery shows an empty `.pp-site-form-page__card` slot where the kit has the card.
   - Learn more ending: Recruitment, Onboarding, Compliance, Leave, Security, Platform.
   - Piece: one example per shared piece below, named `Piece: <name> (<device>)` (id `learn-piece-<kebab>-<device>`).
   - Sample, `Sample (<device>)`, id `learn-sample-<device>`: a whole page, see "The sample page".
3. Pieces. Each is a section of a kit page that only uses shared parts, so the builder shows it as its own example. Rule: the first shared-only demo that uses the piece and is not already taken.

   | Piece | Kit page | `data-demo` | Kit script |
   |---|---|---|---|
   | timeline | Recruitment | `follow` | `site-recruitment.js` |
   | document read | Onboarding | `read` | `site-onboarding.js` |
   | suggestion | Leave | `appr` | `site-leave.js` |
   | live status | Onboarding | `follow` | `site-onboarding.js` |
   | approval decision and log line | Security | `sec-appr` | `site-security.js` |
   | choices and slots | Platform | `plat-roles` | `site-platform.js` |

   The approval example also needs the `pp-site-queue` and `pp-site-who` parts the Security demo uses, so the example is the kit's section in full.
4. Page. A Learn more page (`ppSiteLearnPage` in `src/app/ds/site/learn/`) is: breadcrumb, one `h1` with its shine line, two site buttons, the Built for list, the card slot, then the sub-menu (`nav[aria-label="On this page"]`), demo sections, Questions, Ask Batsi, the strip, the related cards and the closing band. It takes content as data (words are Iggie's, copied from the kit, never written by the builder).
5. Start signal. A demo section starts when at least 40% of it is in view (the kit uses 35%; the card says 15%, see below). Once started it sets `data-site-live` on `.pp-site-demo`. It plays once, keeps its place when it leaves and returns, and "Play again" (`.pp-site-demo__again`) restarts it and keeps focus on the button.
6. Hook. `window.__ppSiteClock = { pending(), observers() }` on every `/dev` page (as in SITE-03): `pending()` counts the timers the site code still holds, `observers()` the view observers. After `data-site-still` is set, or after the page leaves, both are 0.
7. Motion. Only `transform` and `opacity` animate (and the DS button colour transitions and `grid-template-rows` on `.pp-site-faq__a`, which the kit uses). Reduced motion (Iggie, 13 Nov, confirmed 17 Nov; design system PR #49): every demo keeps playing at its normal timings, with its fades, colour and status changes, typing, counts, the slow light and the CSS loops at the slower lengths the design system gives them; only grain, the flying board card (a card sliding between Recruitment board columns still lands in its new column), pointer tilt and other large movement stop. So a demo's timers are NOT shortened or skipped under `prefers-reduced-motion` (`DemoClock.at` must use the delay it is given, `onView` must wait for the view), and no script slides, flies or tilts anything. `data-site-still` is a separate rule: it stops every loop and animation, with or without reduced motion, shows the last step and leaves no timer.
8. Server render. `src/app/ds/site/learn/learn.ssr.spec.ts` renders a full `ppSiteLearnPage` with all six endings on the server (`platform-server`, `renderApplication`), as `src/app/ds/site/**` SSR specs do (mirror SITE-02). `npx ng test --watch=false --include src/app/ds/site/learn/learn.ssr.spec.ts` passes.
9. Signed-in code stays as it is: no site script on `/sign-in` or `/hr`, `src/app/ds/all.ts` and `src/app/features/` (outside `features/public/`) unchanged.

The selectors the tests use (so the builder's markup keeps the kit's classes): `.pp-site-stage`, `.pp-site-demo`, `.pp-site-demo__again`, `.pp-site-read__decide .pp-button--primary`, `.pp-site-approval__decide`, `.pp-site-slot[data-r]`, `.pp-site-faq__q`, `.pp-site-faq__a`, `.pp-site-ask__chip`, `.pp-site-batsi`, `.pp-site-subnav*`, `nav[aria-label="On this page"]`, `.pp-site-hcard` (not compared), `.pp-site-form-page__card`, `.pp-site-band`.

## The sample page

The page helper needs a whole page to run on. The gallery's `Sample (<device>)` is the kit's Leave page cut down: only the `types` demo, two sub-menu tabs ("Leave types" and "Questions"), no closing band and no hero card (`.pp-site-hcard, .pp-site-band` omitted on the kit side). The kit page ids drop their last `-xxxx` suffix (`normId`) on both sides. The sub-menu and ending tests add a 1400px spacer after the page, since the kit has no rule for "last tab current at the page end".

## The page helper (`support/site-08/learn-page.ts`)

SITE-09 to SITE-14 call it with their own page: `checkLearnPage(env, spec)` runs every check, each check opens its own context and can be called alone.

- `LearnPageSpec { name, kitPage, device, onlyDemos?, omit?, open }`: the page's name, the kit page it is compared to, the device, which kit demos the page has (default all), selectors left out of the kit side, and `open(page)` that goes to the page.
- `Env { browser, baseURL, page }`.
- `checkPageParity` (every box within 1px, at most 1% of pixels differ), `checkPageWords` (words both ways, banned words), `checkTop`, `checkSubmenu`, `checkSections`, `checkEnding`, `checkMotion`, `checkAccessibility`, `hiddenFocusables`.
- `Opts { plant?, deaf? }`: `plant(page)` changes the page before the check (the self-test uses it to plant faults), `deaf` replaces the view observer with one that never reports.
- `learnSampleSpec(device)`: the gallery's sample page as a `LearnPageSpec`. `normId`, `SAMPLE_OMIT`, `MOTION_PROBE`, `motionProblems`, `SLID_PROBE`, `slidControlSees`, `checkDemoView`, `LEARN_CHECKS`, `judgeTop`, `judgeEnding`, `deviceOf` are exported for the spec. `checkDemoView(env, spec, opts)` is the real-observer flow (spacer first, not started at 6%, started at 60%, away and back equals the kit); `SLID_PROBE` (since .2) records every script-driven animation (`Element.animate`, or a Web Animations animation that no CSS made) that moves something by transform, translate, rotate, scale or an offset path, on any element; CSS loops and CSS transitions are the kit's and are judged by comparison; `slidControlSees` proves the probe sees a slide; `expectSameRun(label, app, kit)` is the timeline compare (states in order, each within 250ms, states under 45ms not compared). `support/site-08/reduced-motion.ts` (new, .2) exports `freezeTimers`, `loopsIn`, `tiltMoves`, `tiltCompare`, `tiltControlSees`.
- AC-12 is the self-test: every check passes on the sample page, and fails when a fault is planted (tab order changed, a question missing, a deaf view so the demo never plays, a second `h1`, a changed word, four more pixels above the lead; since .2 also, in the motion check: a demo skipped to its end under reduced motion, a demo 300ms late under reduced motion, a step that flies under reduced motion, a loop the kit does not have (grain), a pointer tilt, a loop under `data-site-still`). `checkMotion` now judges every live demo of the page against the kit under reduced motion (timelines, script moves, loops, pointer) and `data-site-still` in both settings; `checkAccessibility` reads the page twice (first step, then every demo played under reduced motion).

## What each test judges

- AC-1 one gallery section per example, with the ids and `data-example` names above; the words of each section against the kit's, both ways (the hero card left out); none of `lorem`, `placeholder`, `masked`, `claude`, `pepla` in the page text.
- AC-2 each example against the kit: every box within 1px, at most 1% of pixels differ (channel difference over 24). Items are matched by tag, `pp-` classes and own text, in order. Motion is frozen on both sides first.
- AC-3 the six page tops: breadcrumb items as the kit's (2 or 3), one `h1` with its shine line, two site buttons, the Built for list, the card slot, rings only where the kit has them. A link with no target does not move the page.
- AC-4 the sub-menu: "On this page", sticky under the shrunk 56px header, 56px tall, the current tab follows the scroll, the highlight moves by `transform`, a tap lands the section top at 112px from the window top (56 + 56, within 4px, or at the page end), the tabs scroll sideways when they do not fit.
- AC-5 the demo section shell on white, cream and flipped; plays only when in view (not started with 6% in view, started with 60%); away and back keeps its place and equals the kit; the Leave types rows step as the kit steps them; Play again restarts and keeps focus, Enter restarts.
- AC-6 the six pieces: the page passes through the same states as the kit, in the same order, each within 250ms; and the by-hand versions (accepting a read, approving and declining, choosing a role) do the same.
- AC-7 the endings: Ask Batsi plays each of its three answers as the kit does (states and times); the strip, the related cards and the questions are the kit's and work (a question opens, the others close).
- AC-8 motion: only `transform` and `opacity` (and the allowed ones above) animate over the whole gallery. Under reduced motion every example is opened beside the kit's: the pointer goes over it and nothing tilts (what moves is what the kit's hover rules move), the white demo (and on desktop the cream and flipped one, started by Play again), the six pieces and Ask Batsi (first ending, first question) play and pass through the kit's states in the kit's order, each within 250ms, a timer is queued while the demo plays (`pending()` above 0), no script moves anything, and the CSS loops running are the kit's at the kit's lengths (no grain). Controls: the slide probe and the pointer check each see a planted fault. `data-site-still` (with and without reduced motion) shows the last step of every demo and piece (the failing example is named), nothing loops, `pending()` is 0; a replay and a leave clean up their timers and observers.
- AC-9 the SSR spec exists, renders a full page with all six endings, and passes.
- AC-10 axe finds nothing on the gallery (any impact), with a question open and with Ask Batsi in each of its three states; nothing reachable by Tab sits inside an `aria-hidden` container. Read twice since .2: on the first step of every demo (views never report), and under reduced motion after every view has fired and every demo has played (12s, every timer cancelled, animations stilled).
- AC-11 signed-in code untouched and the file rule below.
- AC-12 the page helper, as above.

Tolerances: boxes 1px; pixels 1% (channel difference over 24); timing 250ms; states shorter than 45ms are not compared; the sampler runs every 20ms; the sub-menu tap 4px.

## The file rule (AC-11)

The base is the merge-base of HEAD with `origin/develop` (else `develop`). In CI (shallow clone) it is `HEAD^1`, never the commit itself. The list is `git diff --name-only --no-renames <base> HEAD` from `pepla-web`. The rule applies only when the change holds a file of this card (`src/app/ds/site/learn/` or the site-08 test files); otherwise the check is skipped (develop alone passes it). Every file must match the anchored allow-list:

- `src/app/ds/site/**`
- `src/app/features/public/**`
- `src/app/app.routes.ts`, `src/app/app.routes.server.ts`, `src/app/site.routes.ts` (the three route files)
- `src/app/ds/README.md`
- `e2e/acceptance/site-NN.spec.ts`, `e2e/acceptance/cards/site-NN.md`, `e2e/acceptance/support/site-NN/**` (NN two digits)

Refused outright: `src/app/ds/all.ts` and `src/app/features/` outside `features/public/`.

Table run (the spec runs the same tables): 14 files of a plausible builder PR (`src/app/ds/site/learn/**`, `src/app/app.routes.ts`, `src/app/ds/README.md`, the site-08 test files, a `features/public` page, a later site card's files) are all accepted; 25 must-reject paths (`ds/all.ts`, `features/hr/`, `features/sign-in/`, `core/auth.ts`, `package.json`, `angular.json`, `.output/`, `README.mdx`, `.bak` files, `../pepla-api/`, `site-8.spec.ts`, `onb-09.spec.ts`, and look-alikes) are all rejected.

## Where the card and the tests differ

The kit is the approved page. Where the card text and the kit differ, the tests follow the kit, and these are the places.

- Start threshold: the kit starts a demo at 35% in view, the card says 15%. The tests judge "not started at 6% in view (below 15%)" and "started at 60% (40% or more)", so either number passes between 15% and 40%.
- Choices and slots are `aria-pressed` buttons in a named group, as in the kit. Arrow keys are not tested.
- A sub-menu tap lands the section top at 56 + 56 within 4px (or at the end of the page).
- A FAQ item closes the others when one opens (the kit does), and `grid-template-rows` on `.pp-site-faq__a` animates (allowed in AC-8). The DS button colour transitions are allowed in AC-8.
- Breadcrumb: the tests compare the items to the kit (2 or 3), the card said 3.
- The page-top hero card is not compared, on either side.
- The sample page is the Leave page cut down (one demo, two tabs, no closing band); it is not a page the card names.
- The test pieces: the card says "shared pieces" without a list; the table above is the tests' reading (coordinator-approved for the approval piece: Security `sec-appr`).
- The kit ref is pinned in the tests (child lock .2), not read from `sync.json`; `SITE_KIT_REF` overrides it.
- AC-11 is red on develop: it first checks the repository state (`src/app/ds/site/learn/` holds a `.ts` file that is not a spec, and `src/app/app.routes.ts` holds a `dev/site-learn` route), with no skip. Only the file rule after it is skipped, when a pull request changes none of this card's files (other cards' PRs).

## Added by the lock check (what a builder must know)

- Reduced motion: see "Child lock .2" below. (The lock check's reading, that reduced motion shows every step and nothing slides, and that the design system's `.pp-site-step` pop cannot stop, was replaced by Iggie's rule.)
- The phone demo section in the kit is not `data-live`: it starts by Play again, not by view. `checkDemoView` and the white-demo runs click Play again first on phone.
- The gallery must carry no `h1` of its own (AC-3 counts one `h1` per page top).
- `data-site-still` is set on the `html` element, not on the stage.
- Do not edit `src/app/ds/README.md`: the SITE-03 and SITE-04 AC-12 lists reject it, though this card's own list allows it.
- Links with `href="#"` must not navigate (the app has `<base href="/">`). Play again must call `focus()` after the restart (a script click does not move focus).
- The sample page's desktop and phone copies share plain ids (`types`, `questions`): resolve sub-menu targets inside the page element, not by document id.
- AC-9: the SSR spec text must hold `platform-server`, `renderApplication(`, `ppSiteLearnPage`, the six ending names, `pp-site-faq__q`, and `not.toContain('pp-site-reveal--in')` (or `not.toMatch`), with at least one test that passes, none skipped or todo.

## Child lock .1: fonts before parity

`checkPageParity` waits for `document.fonts.ready` on both pages and then dispatches a `resize` event on both before it compares, so the kit's sub-menu script (which measures its links when it first runs, before the web font has loaded) and the page's own measure again on the same fonts. Found on CI: the sub-menu highlight was 113px on the page against 117px in the kit. SITE-09 to SITE-14 call the same check. No tolerance changed.

## Child lock .2: reduced motion keeps the demos playing

The rule (Iggie 13 Nov, confirmed 17 Nov, "Reduced motion: demos play"; design system PR #49, ref c3788a5): under `prefers-reduced-motion: reduce` the demos play at their normal timings (fades, colour and status changes, typing, counts, slow ambient light, the CSS loops at the slower lengths in the kit CSS). Only grain, the flying board card, pointer tilt and other large movement stop. A card sliding between board columns still lands in its new column. `data-site-still` still stops every loop and animation. The design system's `.pp-site-step` pop (opacity and an 8px rise by CSS transition) is the kit's own and stays, so there is no design system rule to wait for; the old workaround test (`SLID_PROBE` on steps only) is replaced.

- Kit ref: pinned in `support/site-08/kit.ts` (`SITE_KIT_REF`, default `03df8e2aa41ed09dc7a1571f074b3d8c82ffde9a`, DS main head of 18 Nov 2026 with #47, #49, #50, #51, #54 (the closing claims "A person makes every hiring decision" and "no retyping" are gone from the Recruitment ending and top) and #57); the env variable of the same name still overrides it. Before, the default was the ref in `sync.json`.
- What the Learn more kit does under reduced motion at the pinned ref: its demo scripts (`site-demos.js`, `site-pages.js`, `site-recruitment.js`, `site-onboarding.js`, `site-compliance.js`, `site-leave.js`, `site-security.js`, `site-platform.js`, `site-page-heroes.js`) are byte for byte the same at c0de954, e9a352f (the ref in `sync.json`), c3788a5 and the pinned ref (checked with cmp); none zero-delays or skips a step, so the pin changes no Learn more script, only the `site-pages.html` note below. Only `site-recruitment.js` reads the setting: the hiring board's card flight is not started (the card still moves to its column). `site-pages.js` scrolls without smoothing. Nothing in them tilts. The one change between c0de954 and the pinned ref in the kit files these tests read is `site-pages.html`, which no longer carries the closing band note (SITE-09 already knew). The CSS (`site.css`) is the same file at the pinned ref and in the app's synced design system, and holds the reduced rules: slower loop lengths (light, drift, rings, gradient line, logo mark), no hero grain, no menu tilt, sheet panel fades instead of sliding.
- What the gallery cannot show: the Recruitment hiring board (the flying card) is not one of SITE-08's examples, so no SITE-08 test can see a card fly; the probe is shown to be alive by a planted slide, and the board itself is SITE-09's (`boardFlight`). The page-top hero card (the other place a pointer could tilt) is not in the gallery either, so the pointer check compares what the pointer moves with the kit's own hover rules, on the gallery and on a page.
- Builder contract: `DemoClock` (and `learn.clock.ts`, and anything that copies them) must not shorten a delay or start a demo at once under reduced motion: `at(ms, fn)` runs after `ms`, `onView` waits for the view, loops are not stopped (the design system CSS slows them). Only a board card's flight is skipped. `window.__ppSiteClock.pending()` is above 0 while a demo plays under reduced motion.
- Changed tests: AC-8 (rewritten: every example under reduced motion beside the kit; still mode per example, with and without reduced motion), AC-10 (second read after the demos have played), AC-12 (six planted motion faults; `checkMotion` and `checkAccessibility` of the helper changed as described above). Unchanged: AC-1 to AC-7, AC-9, AC-11, and every tolerance (20ms sampling, 45ms settle, 250ms, 1px, 1%).
- Helper contract for SITE-09 to SITE-14: every exported name and signature of `kit.ts` and `learn-page.ts` is as before (`kitRef()` and `syncJson()` remain, `SITE_KIT_REF` the constant is new). New exports: `expectSameRun` (learn-page.ts) and `support/site-08/reduced-motion.ts`. `checkMotion(env, spec)` now needs the page's kit demos to play under reduced motion at the kit's timings, nothing moved by a script, the kit's loops and no pointer tilt; `checkAccessibility(env, spec)` reads the page again after the demos have played (11s).
- Lock check .2 additions (reduced motion): the pointer is read while it is over the page (five stops, 600ms each, at the same distances from the scope's top-left on both pages) and every move on the page must be one the kit's hover rules make too (a tilt that settles back when the pointer leaves is seen now); every transition of the scope (property, length, delay) must be the kit's, read before anything starts (a fade removed or slowed under reduced motion is caught); a large move made by a CSS transition (a shift over 16px or a rotation; a scale is not counted: the hero card's bars grow by scale) that the kit does not make is caught next to the script slide (`slidCssOf`, new export; nothing is recorded for 1.2s after a pointer event, so hover lifts are not counted). The AC-12 plants for grain and tilt now reach the check (they threw a TypeError in the first context, and the grain plant set an inline inset that the normal-motion rule caught first); each of the planted motion faults is asserted by the message of the check that names it, and three more are planted (a hover-only tilt, a CSS-transition flight, a slowed fade). AC-8 may run 14 minutes: its timeout is 30.

## Child lock .4: fonts before every compare

`settle` in `support/site-08/kit.ts` (used by AC-2 and by the page parity checks of SITE-08 to SITE-11) now calls `settleFonts` (support/fonts.ts) before it waits on `document.fonts.ready`. `document.fonts.ready` resolves at once when the browser has not yet asked for a font, so a page could be measured in the fallback font while the other was in the web font. CI, 21 Nov: AC-2 at phone width, "in one record." was 40.8 tall in the kit and 81.6 on the page (one line against two). This is the same cause as SITE-07 child lock .6. A font that never arrives now fails by name. No tolerance changed, no check removed; a planted 12px difference is still caught by AC-2.
