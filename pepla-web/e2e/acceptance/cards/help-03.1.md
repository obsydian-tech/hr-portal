# HELP-03.1

Card: HELP-03.1 The "no caption bar" check allows 1% of the bottom strip to differ, not 0.2%

Test files: `help-03.spec.ts`

AC-3 compares the bottom 110 px of each help picture with the reference to prove no caption bar was drawn. That strip holds the last list rows of HR home, and text smoothing alone moves it more than 0.2% on CI. A real caption bar covers about 4% (desktop) to 13% (phone) of the strip, so 1% still catches it. Same limit as HELP-01.4 and HELP-02. Nothing else in the test changes.

Locks: acceptance-lock/help-03.1
