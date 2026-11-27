# REC-UI-03

Card: REC-UI-03 Interview feedback (NH-229, epic NH-223, red: a public page reached by a link). This lock is step 1: the guest scoring page.

Test files: `rec-ui-03.spec.ts` and `support/rec-ui-03/` (`guest-fake.ts`, `kit.ts`). It reads `support/rec-14/schema.ts` (the openapi checker) and `support/rec-07/dev-ids.json` (AC-14 only) and changes neither.

Spec: `onboarding-cards/specs/REC-UI-03.md` rules 4 and 5, AC-3 (phone), AC-5 to AC-8, AC-12 and AC-13 for this page, and AC-14's guest part; `REC-UI-00.md`. Backend: REC-07 (PR 501), `lambda/submitVoteByToken/rec07.mjs` and `api/openapi.yaml` (`GET` and `POST /v1/scoring-links/{token}`).

Locks: acceptance-lock/rec-ui-03.

## What is in this lock and what is not

In: the guest page at `/score#token=…`: what it shows (AC-5), the phone (AC-3), the submit (AC-6), the one refusal state and the load failure (AC-7), public page hygiene (AC-8), words and kit match (AC-12, AC-13), and the dev run of a real guest link (AC-14 guest part).

Not in (their backend is not built, so a test would judge a pretend server): the panel member's feedback sheet (rules 1 to 3, AC-1 to AC-4: there is no read of one interview by its id, and the candidate's interview list is REC-15 step D), and the hiring manager's page (rules 6 to 8, AC-9 to AC-11: no tasks route, gap G-10; `can_decide` is REC-15 step C). Each comes as a child lock rec-ui-03.N when its backend merges.

## How the tests run

Every test runs at 1280 and 390 wide unless it says why not. The browser is en-ZA in Johannesburg; one describe moves the guest's clock to New York.

The fake (`guest-fake.ts`) answers only the two scoring routes, the way `rec07.mjs` does: the token form (20 to 128 of A-Z a-z 0-9 _ -), one 410 `{"error":"Scoring link has expired"}` for an expired, used, unknown or malformed link, the POST body checked as `checkBody` checks it, the link marked used on the first good POST, and the gateway's CORS (no credentials; allowed headers authorization, content-type, idempotency-key). Every 200 GET answer is checked against `api/openapi.yaml` (no extra fields), except the one AC-5 test that sends extra fields on purpose. It answers only the TalentFlow host in `src/environments/environment.ts`; a scoring call to any other host fails the test.

`kit.ts` is generated from `project/ui_kits/recruitment.html` ("Guest scoring page" and its phone screen) at the design system ref the app is pinned to (`src/styles/design-system/sync.json`, 449bc5b) by `onboarding-cards/rec-ui-03/gen-kit.py`. AC-13 first checks the app is still synced to that ref.

AC-14 runs on pepla-dev only (`ACCEPTANCE_TARGET=pepla-dev`, `@pepla-dev`), once at 1280. It needs `E2E_HR_EMAIL` and `E2E_HR_PASSWORD` (HR with the Recruitment tick in company A). HR makes a fresh guest link with `POST /v1/candidates/{id}/scoring-links` for the candidate and interview in `support/rec-07/dev-ids.json`; the test scores once, then checks the second visit and company B's link show the same state. No email is sent: the link is made by API and opened by the test.

## Decisions where the card is silent (the builder follows these)

- D-RUI-03.4 The link is `/score#token=<token>`, not `/score/:token`. Why: a fragment is never sent to a server, a CDN log or a Referer; ONB-17's set-password link already works this way. The page reads the token, takes it out of the address (`/score`, D-RUI-03.1) and only then calls the API. Whoever builds the email link (REC-UI-02 schedule drawer or REC-09) builds this form.
- D-RUI-03.5 The page lives outside `features/public/` and `ds/site/` (for example `features/score/`), and its route goes in `site.routes.ts` before the app routes, so it loads no sign-in code and no SITE lock's file check sees it as a site change.
- D-RUI-03.6 (rule 7a, U-1 pattern): every refused link shows "This link could not be found." A load that fails for another reason (5xx, 429, no connection) shows "Interview feedback could not be loaded." with "Try again". A failed submit shows "Your change could not be saved. Try again." and keeps every value.
- D-RUI-03.7 Interview types read as words in sentence case plus " interview": Phone screen, Technical, Behavioral, Culture fit, Final; any other code in sentence case (PANEL_REVIEW reads "Panel review"). Follow-up F-RUI-03.1: the answer should carry the type's label.
- D-RUI-03.8 With no role title the line starts at the interview type.
- D-RUI-03.9 Dates are Johannesburg dates, day with no leading zero ("3 Nov 2026"), whatever the guest's own time zone.
- D-RUI-03.10 `/score` with no token, an empty token, or after a refresh shows the refusal state and sends no request. The guest page has no "Scores are advice" line and no Cancel button (the answer names no decider; there is nothing to go back to).
- D-RUI-03.11 An old-style link (`/score?token=…` or `/score/<token>`) shows the refusal state and sends no request. With both a query and a fragment, only the fragment's token is used, and the address ends as `/score`. Why: a token in a query or path reaches server and hosting logs and a Referer; the page must never encourage that form.

## Things the builder must know

1. Read the token on navigation, then call `router.navigateByUrl('/score', { replaceUrl: true })` and send the GET only after that resolves. `Location.replaceState` alone is not enough: the router puts the fragment back at the end of navigation. A second link opened in the same tab (`location.hash` change, no page load) must reset the page and load the new link.
2. Use `fetch` (or `HttpClient` without the app's interceptors) with no credentials and only a `content-type` header on the POST. No Authorization header, even when HR is signed in in the same browser. No `Idempotency-Key` (the guest route does not take one).
3. Set `<meta name="robots" content="noindex">` and `<meta name="referrer" content="no-referrer">` while the page shows. Write the token nowhere: no console, storage, history state, analytics or other request.
4. Use the design system parts the kit uses: `pp-sign-in-page`, `pp-slider` per criterion (1 to 5, unset at first), `pp-field` with a tiles `pp-radio-group` for Decision, `ppTextarea` with `maxlength="2000"`, `ppButton` primary "Submit feedback", `pp-section-message` for the save failure. No shell parts.
5. The DS slider shows the lowest value's words while it is unset, so a guest who wants a 1 must move the slider; "unset" is the component's own state, not the value shown.
6. The text check (AC-8) reads every non-test `.ts` file under `src/app` that names `scoring-links`; `core/api/openapi.d.ts` is skipped.
7. Read the token from the fragment with a regular expression, as `features/set-password/set-password.page.ts` does. ONB-17's AC-12 text check refuses any line where `searchParams` (so `URLSearchParams`) and `token` meet.
8. Add a `score/:old` route (or a matcher) to the same page so an old path link shows the refusal, not the app's sign-in or not-found page.
9. Catch every failed call yourself. Any uncaught error in the page fails every test (an unhandled `HttpErrorResponse` carries the request URL, so the token, into the console). On a refusal, load failure or save failure the address stays `/score` and the token is in no markup, console line, storage or other request.

## Leftovers seen while writing these (not this card's)

- The server sends no `Cache-Control: no-store` on the scoring answers (REC-07). The page adds no caching; the test checks that.
- The hosting `Referrer-Policy` header is not set for the site (infra); the meta tag covers the page. The dev site already sends `X-Robots-Tag: noindex`.
- The old `generateScoringLink` path still builds `{FRONTEND_URL}/score?token=…` for UUID tokens that the REC-07 routes never accept. Those links show the refusal state.

## Step 3 · Server read GET /v1/interviews/{id} (child lock rec-ui-03.1, with chat-15.6)

Spec: `onboarding-cards/specs/REC-UI-03-next-slices.md`, step 3 (rules 1 to 7, AC-3.1 to AC-3.8) and its notes. Tests: `rec-ui-03-read.spec.ts`, helpers and data in `support/rec-ui-03-read/` (world on top of REC-07's, unchanged). The no-backend tests run the real submitVote handler against REC-14's fake AWS once, at 1280. Child lock `chat-15.6` adds only `get_interview` to the REC-07 line of `chat-15.spec.ts` AC-12.

Pinned where the spec is silent (the builder follows these):
- D-T-3.1 Every refusal is `notFound()`'s whole answer, the same bytes and headers for every reason. No company: requireTenant's 403 before any AWS call. Recruitment off: requireModule's 403, only the module read.
- D-T-3.2 "Has a vote" is REC-07's test (a `VOTE#<caller>#` row on the candidate with this interviewId), old 0 to 10 votes too; their `overall` is worked out the same way.
- D-T-3.3 `why` is a key only when `can.capture_feedback` is false.
- D-T-3.4 The 200 answer passes the schema `api/openapi.yaml` gives the route and lists exactly rule 3's keys (and `why`).
- D-T-3.5 `support/rec-ui-03-read/iam-25bd0e1.json` is submitVote's role and policy lines and its integration on develop 25bd0e1. AC-3.6 compares against it.
- D-T-3.6 The caller is always the signed-in person. A person id sent in a header, the query or the body never changes who is reading.
- D-T-3.7 Any of the four roles who sits on the panel reads it (an HR person and an admin are tested).
- D-T-3.8 `my_vote.overall` counts only the scores whose keys are in `criteria`; if none are, it is null.
- D-T-3.9 `role_title` is the candidate's job title even when the candidate has no role; no job title gives null.

### REC-UI-03 step 3 dev seed

`scripts/ci/seed-dev.py` puts the interview "REC-UI-03.3 read" back on every dev run (like `seed_rec07`, not in `reset-dev-rec04.py`), under the ids in `support/rec-ui-03-read/dev-ids.json`: company A, its own candidate (hiring manager not the manager login), status `SCHEDULED`, started a day before the run, a non-empty `criteria_snapshot`, panel = the E2E_EMP login only, `votesSubmitted` 0, `PANEL_FEEDBACK_PENDING_COUNT` 1. It first deletes the candidate's `VOTE#` and `VOTED#` rows. Nothing for company B, no guest. No test votes on it, so both widths read the same interview. The company B part of AC-3.8 has "company B walk on pepla-dev" in its title, so the dev workflow runs it in the company walk step (E2E_HR_B = the walk company, Recruitment on) and leaves it out of the main run; no workflow change is needed.

### Things the builder must know
- The spec's notes 1 to 4 apply (old votes, one shared mean: exporting `mean` from `lambda/shared/scoring.mjs` is enough).
- `pick-acceptance-specs.py` guesses 180 s for a spec with no timing entry; this one takes about 40 s here. Add a line to `scripts/ci/acceptance-spec-seconds.json` if the shard limit check complains (INT-UI-02 hit this).
- Older locks this route moves (found by running them on the throwaway): `ten-04.spec.ts` AC-2 needs the OpenAPI `get` to document a `403` `{"error":"Forbidden"}` answer, and `rec-14.3.spec.ts` AC-7 needs `pepla-web/src/app/core/api/openapi.d.ts` regenerated (`npm run api:types` in pepla-web) after the OpenAPI edit. `chat-15.spec.ts` AC-12 needs child lock chat-15.6 (merged with this lock).
- Terraform: one route on the existing `submit_vote` integration, named `get_interview`. No second push while its plan runs (LESSONS REC-04).
