# ONB-23.1

Card: ONB-23.1 Tests that sign in twice forget the first sign-in (test-only, follows ONB-23, NH-189)

Test files: changed set-up lines in `onb-03.spec.ts` (AC-13), `onb-07.spec.ts` (AC-8), `onb-08.spec.ts` (AC-9),
`onb-12.spec.ts` (AC-5), `onb-13.spec.ts` (AC-5) and `onb-15.spec.ts` (AC-5), and a new `support/sign-in-again.ts`

Spec: /mnt/project-files/onboarding-cards/specs/ONB-23.1.md

Locks: acceptance-lock/onb-23.1

ONB-23 keeps an employee's session, the same as HR's. Six pepla-dev tests sign in as the employee test login,
then as HR. Between the two they cleared cookies and went to `about:blank`, which leaves the session in local
storage, so `/sign-in` sent them on to `/start` and the Email field never showed. They now call
`forgetSignIn(page)` there, which clears cookies, local storage and session storage for the app's address and
checks that no token is left. No app code changes, and no assertion was changed or removed.

The commit sits on `develop` (f56421a), not on ONB-23, so cards that touch the same spec files (BE-17 changes
`onb-15.spec.ts`, ONB-04.2 changes `onb-03.spec.ts`) can build their test commits on top of it. Clearing the
session is harmless before ONB-23, so the commit passes on `develop` as it is.
