# HELP-04

Card: HELP-04 Help pictures: HR adds a new employee (NH-173)

Test files: `help-04.spec.ts`, `support/help-04.ts`

Spec: [NH-173](https://obsydian.atlassian.net/browse/NH-173)

Locks: acceptance-lock/help-04

The tests run the journey `e2e/journeys/hr-adds-an-employee.e2e.ts` (test "HR adds
a new employee") through `support/journey-harness.ts`, like HELP-01 to HELP-03,
once (in `desktop-1280`), and check its desktop and phone runs. No-backend run
only. They need ffmpeg, ffprobe, ImageMagick `compare` and python3. Nothing in
`support/journey-harness.ts` changes.

`support/help-04.ts` adds a `watcher` to the recorder. Besides the scroll
position and every email and phone number in the page text, it records:

- `shot`: the scroll position when `help.shot` takes the caption down, so the
  reference can take each picture at the same place, and `facts` at that moment:
  an "ID number" row on the page, 13 digits in a row in the page text, the h1;
- `call`: every request the page makes (fetch and XHR), with whether it carried a
  Bearer token and its body, so AC-4 and AC-5 see the routes and the registration;
- `answer`: every answer of the employees and document APIs (method, status, body);
- `input` when a select changes, for "Choose Department".

The reference (`addsAnEmployeeReference`) answers both APIs from the card's
tables in `support/help-04.ts` (`CARD`), not from the builder's fixture exports.
HR home lists the other three new employees until Thandi is registered. On the
phone a picture with the heading in the top third (AC-8) cannot hold the whole
form, so the fields below the fold of 01 and 02 and the three cards of 04 are
judged on the desktop picture; the "no ID number row" check reads the page at
every picture on both widths.

AC-4 also allows the app shell's `GET /v1/company/modules` (MOD-02) on the
employees API, and only that GET. The reference answers it with `["onboarding"]`,
as `e2e/support/help.ts` does. AC-5 compares the invite times as moments, not
text. AC-6 reads the Link sent and Link expires rows in the video's last frame:
each must sit closer to picture 07 (09:05) than to picture 06 (09:00).

The HR partner's `id` is not in the card: AC-5 takes it from the list the page
was given and checks the registration sends that id.

`help-company.ts`: `HELP_PEOPLE`, `HELP_NEW_EMPLOYEES`, `HELP_NEW_EMPLOYEE_STEPS`
and `HELP_JOHAN_DETAIL` are held exactly (AC-5). The fixture source holds
`000 000 0000`, `Operations`, `Junior baker` and `HR-001`; the journey and
`help.ts` hold none of them. HELP-02 and HELP-03 AC-5 (locked) forbid a phone
number among the fixture's exported strings, so AC-11 checks that too: the
phone sits in the fixture outside any exported string.

`sign-in.e2e.ts`, `who-is-starting.e2e.ts` and `hr-checks-a-document.e2e.ts` are
held by their hashes (AC-11).
