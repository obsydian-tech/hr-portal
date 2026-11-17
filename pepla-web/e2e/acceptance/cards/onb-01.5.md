# ONB-01.5

Card: ONB-01.5 AC-2 waits for the earlier sign-in attempt to finish before sending the next address

Test files: `onb-01.spec.ts`

AC-2 sends three well-formed addresses one after another on the same page. The sign-in page ignores a click while it is still working on the last attempt, and the test only waited for the call to reach the fake Cognito. Under load the next click landed too early and was dropped, so the third address never arrived (17 Nov). Before each address the test now waits for the button to stop showing `aria-busy`, so the click is never dropped. Every address is still sent and checked; nothing is loosened.

Locks: acceptance-lock/onb-01.5
