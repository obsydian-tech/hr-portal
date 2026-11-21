# SITE-07

Card: SITE-07 Split the site styles out of the design system's component CSS and load them only on public routes (NH-209, epic NH-202)

Test files: `site-07.spec.ts`, `support/site-07/css-split.ts`; also edits `site-01.spec.ts`, `site-03.spec.ts` and `site-04.spec.ts` (the re-locks below).

Spec: [NH-209](https://obsydian.atlassian.net/browse/NH-209)

Locks: acceptance-lock/site-07, acceptance-lock/site-07.6 (fonts before the JavaScript-off compare)

## How the tests run

No backend. Run with `E2E_BASE_URL` pointing at a running `ng serve`. Every test runs at 1280 and 390 wide, except AC-1, AC-2, AC-6 and AC-7, which read files, run `verify:design` or read the build, so they run once, in `desktop-1280`. AC-2, AC-7 and the prerender part of AC-4 share one `npm run build` (a few minutes; the run uses one worker).

## What each test judges

- AC-1 the sync: `sync.json` names a full commit that moved on from c0de954 and 6c63ab0, lists `site.css`, `platform.css`, `components.css` and `index.css` with matching hashes; `components.css` holds no "pp-site" text; `site.css` holds the site classes; `index.css` and `platform.css` import the right parts in order; `src/styles.css` imports `platform.css` only; `verify:design` passes, fails on a made-up site class and on a hand edit to `site.css` (planted, then restored).
- AC-2 the build: no stylesheet `index.html` links, other than `site.css`, holds a site rule; the initial total is at most 548 kB (printed in the run); `site.css` is in the output; the `budgets` block is unchanged.
- AC-3 first loads of `/sign-in`, `/forgot-password`, `/set-password`, `/hr`, `/hr/documents`, `/start` make no request for `site.css`, receive no stylesheet with a site rule, and hold no link to it.
- AC-4 `/` and `/nothing-here` request `site.css` once and hold one link; with JavaScript off the header and "Log in" are within 1px of the JavaScript-on boxes; the prerendered `index.html` has the link in `<head>`.
- AC-5 where a `pp-site-` class is on the page, `site.css` is loaded and the header is sticky; `/` to "Log in" and back leaves one link.
- AC-6 (route files `app.routes.ts`, `app.routes.server.ts` and `site.routes.ts` are allowed: the spec's own list left them out, but a route provider is one of the hooks decision 4 offers, and SITE-03 and SITE-04 allow them too) no locked SITE-01 or SITE-02 support file is edited and no file outside the split's own changes. It is skipped for a pull request that changes none of the split's files (another card), and finds its base in CI from the merge commit's first parent (as SITE-03 and SITE-04 AC-12 do). The allow-list names whole files.
- AC-7 `verify-public-names` still runs after the build, no output name or link holds "pepla".

## Re-locked line (SITE-01 AC-5, lines 312 to 314)

`site-01.spec.ts` AC-5 read `components.css` and expected the site classes there. After the split they live in `site.css`: the same two checks (`pp-site-header`, and the classes added in 6c63ab0) now read `site.css`. Every other AC-5 check is unchanged.

## Where the card and the tests differ

- The spec says the SITE-01 kit parity sample and the SITE-02 tests "pass unchanged on the build"; those tests run in their own files and CI shard. AC-6 here checks only that their files are not edited.

## Re-locked lines (SITE-03 and SITE-04 AC-12)

The file rule of `site-03.spec.ts` and `site-04.spec.ts` AC-12 runs on every site pull request. It named only test files `site-0N` and only the site, the public pages and the route files, so this card (which changes `angular.json`, `src/styles.css`, the sync and verify scripts and the design system files) and every later Learn more card (SITE-10 and up, with their own test files) would fail it. In both files:

- The test-file patterns read `site-\d{2}` (any two-digit site card) in the `allowed` list, in SITE-03's `siteChange` trigger and in SITE-04's skip trigger.
- `allowed` gains this card's own files, whole names only: `angular.json`, `src/styles.css`, `README.md`, everything under `src/styles/design-system/`, and `scripts/design-system-sync.mjs`, `scripts/verify-design.mjs`, `scripts/verify-design.test.mjs`.
- Kept as they were: the end anchors, the base fallback and the skip. Every other path (the signed-in features, other scripts, `package.json`) is still refused.

## Notes from the lock check

- AC-4 does not count the `<noscript>` copy the production build adds beside a deferred stylesheet link.
- AC-5 also requires `site.css` to be loaded at the first frame that shows a site part (a link added by script after that frame fails it), and covers `/dev/site-landing-page` when that route exists.
- AC-3 fails if a page lost its session and landed elsewhere, so it never tests the sign-in page by mistake.
- The base fallback never accepts the merge commit itself as its own base.

## SITE-07.2 (AC-6 allow-list)

The card's own test commit re-locks `site-03.spec.ts` and `site-04.spec.ts` (the AC-12 widening above), so the pull request's diff holds both files. AC-6's allow-list names them, whole file names only, next to `site-01.spec.ts`.

## Child lock .6: fonts before the JavaScript-off compare

AC-4 compares the header and "Log in" boxes with JavaScript on and off. The page with JavaScript on waited for the network to go quiet; the page with it off only waited a fixed 800ms, so on a busy CI runner it was measured while the web font was still downloading and its text wrapped differently (CI, 21 Nov: 22px apart; reproduced here with the font files delayed 2.5 seconds: 34.6px). Both pages now wait until every web font their text uses has loaded. With JavaScript on that is `settleFonts` (support/fonts.ts). With it off a page never runs a promise, so `settleFonts` would hang there, and a small poll with plain reads does the same job and fails with the names of any font that did not arrive. No tolerance changed, no check removed.
