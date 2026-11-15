# HELP-02

Card: HELP-02 Help pictures: HR sees who is starting (NH-159)

Test files: `help-02.spec.ts`, `support/help-02.ts`

Spec: [NH-159](https://obsydian.atlassian.net/browse/NH-159)

Locks: acceptance-lock/help-02, acceptance-lock/help-02.2, acceptance-lock/help-02.3

`help-02.spec.ts` adds a `watcher` to the recorder (`support/help-02.ts`): it
sees the scroll position, a shown masked value, the full made-up ID number in
the page text, and every email and phone number the page shows.

## HELP-02.3 (15 Nov 2026, with ONB-09 / NH-166)

- `journeys/sign-in.e2e.ts` sends each person's `step` from `HELP_NEW_EMPLOYEE_STEPS`, so the
  HELP-01 HR home picture shows the four steps instead of "Not set". AC-11 holds the new hash.
- Both help references (`support/journey-harness.ts` signInReference, `support/help-02.ts`
  whoIsStartingReference) answer the step too, and wait for every web font the page uses
  (`support/fonts.ts` settleFonts) before each picture. `e2e/support/help.ts` does the same
  before each help picture. Before this, a picture taken before a Google font had swapped in
  missed its reference by 0.011 (desktop) to 0.017 (phone) on CI, about one run in three.
