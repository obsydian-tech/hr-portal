# INT-02 · Calendar invite file builder, nothing sent (NH-268, amber)

Spec: `/mnt/project-files/specs/interview-journey/cards/INT-02.md` (25 Nov 2026, spec checks rounds 1 and 2 applied).
Tests: `int-02.spec.ts`, support in `support/int-02/`. Lock: `acceptance-lock/int-02`. Build branch: `feat/int-02-invite-file`.
The test commit also adds `ical.js` 2.2.1 (exact) to `pepla-web` dev dependencies, as the card says. The Lambda does not use it.

## Pinned by the test writer where the card is silent

- **D-T-02.1 Loading.** The tests import `lambda/shared/interview-invite.mjs` in the test process and call `buildInvite`. A missing file,
  or no `buildInvite` export, fails every test.
- **D-T-02.2 InviteError.** A refusal is judged by the thrown error's class name (`constructor.name === 'InviteError'`) and its `code`.
  The class does not have to be exported.
- **D-T-02.3 Every email, every audience.** Rule 1 says "any email". A bad address anywhere in the input (organiser, candidate, any panel
  member, guest) is `BAD_EMAIL` for every audience, even when that person is not listed in the file being made.
- **D-T-02.4 AC-8 pieces.** A string literal (or template text outside `${}`, cooked) passes when it is the empty string, one of rule 1's
  two patterns, or made only of AC-8's items one after another (so `'BEGIN:VCALENDAR'` and `'ATTENDEE;CN="'` pass). The input's field
  names may be joined with `.`, `[` and `]` (`'interview.length_minutes'`). Outside the two fixed strings that hold a space (the `PRODID`
  value and the content type), no literal may hold a letter or digit, a space and a letter (so `'interview at place'` fails although every
  word is a field name). The card's `\\n`, `\\,`, `\\;` and `\\` are read as the values the code holds (a backslash and the character).
- **D-T-02.5 typeof names.** A JavaScript type name (`'string'`, `'number'` and the rest) passes only when it is compared with a
  `typeof` expression. It is the language's word, never written to a file. Anywhere else it fails.
- **D-T-02.6 Regular expressions and word makers.** A regular expression passes when it is one of rule 1's patterns, or when each run of
  three or more letters in it (escapes such as `\u0000` and `\s` left out) is a word of an AC-8 item (`https`, `mailto` ...). The names
  `fromCharCode`, `fromCodePoint`, `atob`, `btoa`, `eval`, `Function`, `require`, `process`, `fetch`, `readFile`, `readFileSync`, `Intl`
  and the `toLocale...`, `toDateString`, `toTimeString`, `toUTCString`, `toGMTString` calls fail, and so does `import()`: they make words
  or read text from elsewhere. Comments are never judged.
- **D-T-02.7 Run-time words.** AC-8 also builds every audience and method and checks that each property and parameter name is on the
  card's list, that `SUMMARY` and `DESCRIPTION` are exactly the caller's text, and that there is one `VEVENT` and nothing else.
- **D-T-02.8 Folding "at 75".** A physical line followed by a continuation line holds at least 72 octets (75 minus the most a whole
  character can leave over), so the builder folds at 75, not earlier.
- **D-T-02.9 CRLF inside text.** "Newline as `\n`" covers CRLF and LF: the text reads back with one newline for each. A bare CR is removed.
- **D-T-02.10 Missing fields tested.** `length_minutes`, `sequence` (the card's), and also `interview.at`, `interview_id`, `now`,
  `organiser.email`, `candidate.email` (candidate file) and `text.summary`. A row with no `tenant_id` may be `MISSING_FIELD` or
  `COMPANY_MISMATCH`; either passes, a built file does not.
- **D-T-02.11 Company compared exactly.** `tenant_id` values are compared as they are: upper case or a trailing space is another company.
- **D-T-02.12 Online.** `LOCATION` and `URL` are the video link; a `place` given with an online interview is not used.
- **D-T-02.13 The candidate's own line** (lock check F-4). The candidate's attendee line is exactly one of
  `ATTENDEE:mailto:{email}`, `ATTENDEE;CN="{first}":mailto:{email}` or `ATTENDEE;CN="{first} {last}":mailto:{email}`. The builder picks
  which; no other name or parameter.
- **D-T-02.14 A booking with no guest** (lock check C-1). `guest` left out builds the PANEL and CANDIDATE files.
- **D-T-02.15 No company.** A row or company whose `tenant_id` is left out, `null` or `''` is refused (`MISSING_FIELD` or
  `COMPANY_MISMATCH`), never built.

## Not judged (no rule on the card)

An unknown `where`; `length_minutes` or `sequence` that is not a whole number, or `sequence` of 0; a `guest.name` of `''`; a video link
starting `HTTPS://`.
