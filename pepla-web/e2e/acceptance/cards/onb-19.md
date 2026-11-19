# ONB-19

Card: ONB-19 Where am I: four steps (NH-177)

Test files: `onb-19.spec.ts`, `support/onb-19/` (the words, a fake that adds `step` to the `/v1/me` answer, TEN-02's two-company
world with steps, an OpenAPI field reader, and a snapshot of the `getMyStart` role's IAM lines on develop c859f0f), and two
re-locked files of other cards (below): `onb-05.spec.ts` and `support/mod-02/baseline.json`.

Spec: [NH-177](https://obsydian.atlassian.net/browse/NH-177)

Locks: acceptance-lock/onb-19, acceptance-lock/onb-05.3, acceptance-lock/mod-02.2 (all three point at the same commit)

An employee gets a "My onboarding" page (`/start/onboarding`) with the four steps (Invited, Documents, In review,
Verified), the one they are on, "<n> of 4 steps done" and what is left for them to do. The step is the one HR sees
(`stepOf(row)`), sent on the person's own `GET /v1/me` as a new field `step`. Today's two-step tracker says "Your ID and
bank letter are in." once the step is In review or Verified.

Screen tests (AC-1, AC-2, AC-3, AC-4 screen, AC-5 screen, AC-6, AC-7 screen, AC-8, AC-9, AC-11 no-AI) run at 1280 and 390
wide with no backend. AC-10 runs at 390 only. The Lambda and text tests (AC-4, AC-5 Lambda, AC-7 registry, AC-11 text) run
once, in `desktop-1280`, against the real `lambda/getMyStart`, `getEmployees` and `getEmployeeDocumentVerifications` and
TEN-02's fake AWS (companies A and B, a caller of each). AC-12 runs on pepla-dev only.

## Words

All from the spec's proposed wording, which Iggie approved (16 Nov, Q1 to Q7). They live in `support/onb-19/words.ts` and
nowhere else in the tests.

## Choices made while writing the tests (not in the card)

1. The shell marks Today `aria-current="page"` on every `/start/*` page (its link is not exact), as HR's Today does on
   `/hr/documents`. AC-7 therefore checks only that the open page's own link is marked, and that My onboarding is not marked
   on `/start`.
2. The `getMyStart` role's IAM lines are pinned (`iam-c859f0f.json`): the card needs no new line.
3. The 44 pixel check on Today skips ONB-05's own "Read the privacy notice" link (it is not this card's).
4. On a phone the tests press the menu button until the drawer is on screen, because the page may not answer the first press.

## Changed tests of other cards (re-locks)

- `onb-05.spec.ts`: AC-5's `LISTED` adds `step` (after `documentsDue`); AC-7 now expects two sidebar items, Today then
  "My onboarding" (`/start/onboarding`). Locks: acceptance-lock/onb-05.3.
- `support/mod-02/baseline.json`: the employee block of both projects gains the My onboarding item (label, href, icon,
  box). HR, the top bar and every redirect are byte for byte as before. Locks: acceptance-lock/mod-02.2.

## ONB-19.1: AC-12 reads the answer the page got (lock acceptance-lock/onb-19.1)

The first pepla-dev run after the merge (run 44392612187, develop 7f10393) failed AC-12 on the test, not the app: GET
/v1/me answered 200, then reading its body failed with "Response body is not available for a response that was navigated
away from". The test waited for any GET /v1/me, so a call Today still had on its way could be the one it caught, and that
body is gone once the browser leaves Today.

AC-12 now opens the page through `support/onb-19/me-answer.ts`: only a GET /v1/me sent by the newly opened My onboarding
page counts, and its body is read inside the response handler as it arrives. What AC-12 checks is unchanged: a 200, a
`step` that is one of the four, and the page, title, line, steps, bar and sidebar matching that step. It also now says
plainly when the answer is not JSON. No other test, word or file changes.

## ONB-19.2: AC-2 counts only the documents calls My onboarding sends (lock acceptance-lock/onb-19.2)

AC-2 failed now and then on develop ("consent is done: GET /v1/me/documents is asked once", got 2), mostly on a phone.
It counted every GET /v1/me/documents the stand-in had logged since Today showed its heading. Today's own documents list
asks GET /v1/me/documents just after that heading shows, and the stand-in logs a call only after reading its headers,
so Today's call could land inside the count.

AC-2's first case now counts with `support/onb-19/sent-by.ts`: a call counts only when the page that sent it, read the
moment it is sent, is My onboarding. A page that asks twice still counts two. Nothing else in AC-2 changes.
