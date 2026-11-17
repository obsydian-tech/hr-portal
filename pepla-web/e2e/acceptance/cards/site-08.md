# SITE-08

Card: SITE-08 Learn more page frame (NH-213, epic NH-202)

Test files: `site-08.spec.ts`, `support/site-08/kit.ts`, `support/site-08/learn-page.ts` (the page helper SITE-09 to SITE-14 reuse), `support/site-08/files.ts` (the AC-11 file rule).

Spec: [NH-213](https://obsydian.atlassian.net/browse/NH-213)

Locks: acceptance-lock/site-08

It builds on `cards/site-03.md` and `cards/site-04.md` (same `window.__ppSiteClock` hook, same kit oracle, same parity method).

## How the tests run

All tests run at 1280 and 390 wide, except AC-9 and AC-11, which read files and run the SSR spec, so they run once, in `desktop-1280` (the `phone-390` run is skipped). The desktop device is read in a 1456 wide window (stage 1440), the phone at 390. The browser starts with `--disable-lcd-text --font-render-hinting=none`.

The kit is the oracle. The tests fetch it from `obsydian-tech/pepla-design-system` at the ref in `SITE_KIT_REF`, else the ref in `src/styles/design-system/sync.json`, and cache it under the temp folder. The kit page is served from the app's own origin under `/__site-08-kit__/`, with `ds/index.css` from the local DS folder. The ref must hold `project/ui_kits/site-pages.html` and `site-pages.js` (c0de954c2b1d60f5b65d894a2664cfa6ffeda2d0 does; the ref 6c63ab0 in `sync.json` today does not, so the tests stop with an error that names `SITE_KIT_REF`). The sync of the DS to that ref belongs to the builder's PR if the run needs it.

```
E2E_BASE_URL=http://localhost:4200 SITE_KIT_REF=<ref> npx playwright test -c e2e/acceptance/playwright.config.ts site-08
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
7. Motion. Only `transform` and `opacity` animate (and the DS button colour transitions and `grid-template-rows` on `.pp-site-faq__a`, which the kit uses). Reduced motion shows every step but nothing slides. `data-site-still` on the stage shows the last step and nothing loops.
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
- `learnSampleSpec(device)`: the gallery's sample page as a `LearnPageSpec`. `normId`, `SAMPLE_OMIT`, `MOTION_PROBE`, `motionProblems`, `SLID_PROBE`, `slidControlSees`, `checkDemoView`, `LEARN_CHECKS`, `judgeTop`, `judgeEnding`, `deviceOf` are exported for the spec. `checkDemoView(env, spec, opts)` is the real-observer flow (spacer first, not started at 6%, started at 60%, away and back equals the kit); `SLID_PROBE` counts only scripted or CSS-animation transform on steps (a CSS transition is not a slide); `slidControlSees` proves the probe sees a slide.
- AC-12 is the self-test: every check passes on the sample page, and fails when a fault is planted (tab order changed, a question missing, a deaf view so the demo never plays, a second `h1`, a changed word, four more pixels above the lead).

## What each test judges

- AC-1 one gallery section per example, with the ids and `data-example` names above; the words of each section against the kit's, both ways (the hero card left out); none of `lorem`, `placeholder`, `masked`, `claude`, `pepla` in the page text.
- AC-2 each example against the kit: every box within 1px, at most 1% of pixels differ (channel difference over 24). Items are matched by tag, `pp-` classes and own text, in order. Motion is frozen on both sides first.
- AC-3 the six page tops: breadcrumb items as the kit's (2 or 3), one `h1` with its shine line, two site buttons, the Built for list, the card slot, rings only where the kit has them. A link with no target does not move the page.
- AC-4 the sub-menu: "On this page", sticky under the shrunk 56px header, 56px tall, the current tab follows the scroll, the highlight moves by `transform`, a tap lands the section top at 112px from the window top (56 + 56, within 4px, or at the page end), the tabs scroll sideways when they do not fit.
- AC-5 the demo section shell on white, cream and flipped; plays only when in view (not started with 6% in view, started with 60%); away and back keeps its place and equals the kit; the Leave types rows step as the kit steps them; Play again restarts and keeps focus, Enter restarts.
- AC-6 the six pieces: the page passes through the same states as the kit, in the same order, each within 250ms; and the by-hand versions (accepting a read, approving and declining, choosing a role) do the same.
- AC-7 the endings: Ask Batsi plays each of its three answers as the kit does (states and times); the strip, the related cards and the questions are the kit's and work (a question opens, the others close).
- AC-8 motion: only `transform` and `opacity` (and the allowed ones above) animate over the whole gallery; reduced motion shows every step and nothing slides; `data-site-still` shows the last step, nothing loops, `pending()` is 0; a replay and a leave clean up their timers and observers.
- AC-9 the SSR spec exists, renders a full page with all six endings, and passes.
- AC-10 axe finds nothing on the gallery (any impact), with a question open and with Ask Batsi in each of its three states; nothing reachable by Tab sits inside an `aria-hidden` container.
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
- The kit repo ref in `sync.json` (6c63ab0) has no `site-pages.html`; the tests need `SITE_KIT_REF` until the sync moves.
- AC-11 is red on develop: it first checks the repository state (`src/app/ds/site/learn/` holds a `.ts` file that is not a spec, and `src/app/app.routes.ts` holds a `dev/site-learn` route), with no skip. Only the file rule after it is skipped, when a pull request changes none of this card's files (other cards' PRs).

## Added by the lock check (what a builder must know)

- Reduced motion: the design system's `.pp-site-step` transitions `transform` with no reduced-motion rule, so "nothing slides" is judged on scripted and keyframe slides only (`SLID_PROBE`). A design-system rule would be the alternative; it is the coordinator's call.
- The phone demo section in the kit is not `data-live`: it starts by Play again, not by view. `checkDemoView` and the white-demo runs click Play again first on phone.
- The gallery must carry no `h1` of its own (AC-3 counts one `h1` per page top).
- `data-site-still` is set on the `html` element, not on the stage.
- Do not edit `src/app/ds/README.md`: the SITE-03 and SITE-04 AC-12 lists reject it, though this card's own list allows it.
- Links with `href="#"` must not navigate (the app has `<base href="/">`). Play again must call `focus()` after the restart (a script click does not move focus).
- The sample page's desktop and phone copies share plain ids (`types`, `questions`): resolve sub-menu targets inside the page element, not by document id.
- AC-9: the SSR spec text must hold `platform-server`, `renderApplication(`, `ppSiteLearnPage`, the six ending names, `pp-site-faq__q`, and `not.toContain('pp-site-reveal--in')` (or `not.toMatch`), with at least one test that passes, none skipped or todo.
