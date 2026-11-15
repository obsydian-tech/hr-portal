# HELP-03

Card: HELP-03 Help pictures: HR checks a document (NH-167)

Test files: `help-03.spec.ts`, `support/help-03.ts`

Spec: [NH-167](https://obsydian.atlassian.net/browse/NH-167)

Locks: acceptance-lock/help-03

The tests run the journey `e2e/journeys/hr-checks-a-document.e2e.ts` through
`support/journey-harness.ts`, like HELP-01 and HELP-02, once (in `desktop-1280`),
and check its desktop and phone runs. No-backend run only. They need ffmpeg,
ffprobe, ImageMagick `compare` and python3.

`support/help-03.ts` adds a `watcher` to the recorder. Besides the scroll
position, a shown hidden value, the full made-up ID number in the page text and
every email and phone number, it records:

- `shot`: the scroll position when `help.shot` takes the caption down, so the
  reference can take each picture at the same place;
- `call`: every request the page makes (fetch and XHR), with whether it carried a
  Bearer token and its body, so AC-4 and AC-7 see the routes and the two decisions;
- `answer`: every document API answer, so AC-4 and AC-5 see the check, the
  comparisons, the confidence, and that no account number reached the page;
- `input` for a text area (the recorder only sees inputs), for "Enter Reason".

The reference (`checksADocumentReference`) answers the document API from the
card's tables in `support/help-03.ts` (`CARD`), not from the builder's fixture
exports. Where the card leaves a value open, `CARD` fixes it: the check time is
the upload time, and the bank letter's confidence is 40.

The journey answers HR home's employee list too (`GET /v1/employees`), as HELP-01
and HELP-02 do. AC-4 allows that call; the card's list leaves it out.

`help-company.ts`: `HELP_NEW_EMPLOYEES`, `HELP_NEW_EMPLOYEE_STEPS` and
`HELP_JOHAN_DETAIL` are held exactly (AC-5); the fixture must hold the reason text.
`who-is-starting.e2e.ts` is held by its hash (AC-11), as `sign-in.e2e.ts` is.
