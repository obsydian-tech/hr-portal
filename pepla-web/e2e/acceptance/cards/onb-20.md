# ONB-20

Card: ONB-20 A document sent back (NH-176)

Test files: `onb-20.spec.ts`, `support/onb-20/` (the "needs a new copy" email cases on ONB-07's harness, a reader of each
role's IAM lines, and two baselines of develop 08f2aa0), and one line of `onb-15.spec.ts` (HR's reason hint moves to W-8,
"{First name} sees this reason."; ONB-15's test names the person it already uses, Naledi). No other locked test file
is changed. ONB-06's documents fake and Lambda harness, ONB-07's email harness and ONB-15's HR page fake and review
harness are used as they are.

Spec: [NH-176](https://obsydian.atlassian.net/browse/NH-176)

Locks: acceptance-lock/onb-20

When HR asks for a new copy (ONB-15's "Ask for a new one"), the person's checklist row says "Needs a new copy", who
returned it and when, HR's reason, and a button to upload a new copy. The new upload brings the row back as "With HR".
The person gets one email, and a test login never does.

Screen tests (AC-1, AC-2, AC-7, AC-8's HR page) run at 1280 and 390 wide with no backend, with today fixed at 17 Nov
2026 so that "10 Nov" and "30 Dec 2025" mean the same whenever they run. AC-5, the phone criterion, runs at 390 only.
`getMyDocuments` hands over `returnedAt`, `returnedBy` and `reason` on a sent-back file; ONB-06's fake passes them
through unchanged. Lambda and text tests run once, in `desktop-1280`: the real `getMyDocuments`,
`reviewDocumentVerification` and `sendNotificationEmail` run against a fake AWS, and Postmark is a recording fake. No
criterion runs on pepla-dev (as the card).

## Words

Every word is one of the card's W-1 to W-8 or the kit (`/mnt/project-files/onboarding-cards/specs/ONB-20.md`, approved
by Iggie 16 Nov). The email is tested word for word, once from the text body and once from what the HTML shows.

## Choices made while writing the tests (not in the card)

1. A name that is an email address is never given to the person. ONB-15 stores HR's email as the name when the token
   has no names, and the card says HR's email is never shown, so `returnedBy` is null then (the row says "Returned 10
   Nov", W-2).
2. A reason that is empty or only spaces is null, and the reason line is left out (W-3). The three fields are always in
   a sent-back file, null when empty, and never in any other file.
3. A date in the current year is "10 Nov", in another year "10 Nov 2025", in South Africa time (the kit's content rule).
4. Qualifications: each sent-back file shows its own reason and "Returned by ..." on its own file row (the upload
   page's list). The tests look for the words inside the file's row, not for a layout.
5. The log line "Decision email skipped: test employee" is the card's wording for a log, not for a person: it is not
   tested; no Postmark call is.

## Not frozen here

CORS lines, and "no new table" (ops-05.spec.ts already pins the table count). A shared infra file changes for other
cards too, so a test of "nothing new" there would fail the wrong PR. The card's reviewer reads the diff for them.

## Shared files

`onb-15.spec.ts`, one line. `reviewDocumentVerification` and `generateDocumentUploadUrl` are pinned by hash
(`support/onb-20/unchanged-08f2aa0.json`): a later card that must change either re-locks that file.
