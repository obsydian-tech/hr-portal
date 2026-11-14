# Acceptance tests

One Playwright test per acceptance criterion of a card, named after it
("AC-3 HR signs in ..."). They are written from the card, before the code, by
the verifier, not by the person who builds the feature. They fail until the
feature is built.

## Card notes

Each card describes its own tests in `cards/<card>.md`, named in lower case after
the card id (`cards/onb-01.md`, `cards/help-01.3.md`): the card, its test files, its
spec, a `Locks:` line naming its lock branches, and anything else about how its tests
run. A new card adds `cards/<card>.md` in its lock commit. It never edits this README
or another card's file.

## Locked

Once Iggie accepts a card's tests, a lock branch `acceptance-lock/<card>` is
pushed pointing at the commit that adds them (a later accepted change gets
`acceptance-lock/<card>.2`, and so on).
The `Acceptance tests locked` check (`.github/workflows/acceptance-lock.yml`)
fails a PR if any other commit changes this folder. A test that looks wrong goes
back to the verifier, and to Iggie if the criterion itself changes.

A card's file changes only under that card's own locks (`<card>` and `<card>.<n>`). A lock
named like a card file is that card, so `help-01.3` is the HELP-01.3 card and not a re-lock
of HELP-01. A merge is judged file by file: it may bring in other cards' files as they are
on either parent, and fails only on a locked file that matches neither parent.

Builders: bring `develop` in with a merge, not a rebase. A rebase rewrites the
locked commits and the check fails.

## Running

From `pepla-web/`:

```sh
npm run e2e:acceptance                     # no-backend run: every criterion, 1280 and 390 wide
```

The no-backend run starts the app on port 4310 and answers Cognito in the
browser with `support/cognito-fake.ts`. The app uses its real Cognito library
(SRP sign-in); the fake answers any `cognito-idp.<region>.amazonaws.com` call,
so the app needs no special settings for it. The fake does not check
passwords (SRP never sends one); tests that need a wrong password say so, and
real password checks run on pepla-dev.

Pages that read the employees list (ONB-02 on) get it from
`support/employees-fake.ts`: it answers `GET <employeesApiUrl>/v1/employees` in
the browser the way `lambda/getEmployees` does (`items`, and `lastKey` while
another page follows) and refuses a call without a sign-in token.

```sh
ACCEPTANCE_TARGET=pepla-dev E2E_BASE_URL=http://localhost:4200 \
  E2E_HR_EMAIL=... E2E_HR_PASSWORD=... E2E_EMP_EMAIL=... E2E_EMP_PASSWORD=... \
  npm run e2e:acceptance                   # pepla-dev run: tests tagged @pepla-dev only
```

The pepla-dev run expects the app already running against pepla-dev, and the
seeded test logins from Secrets Manager `pepla-dev/e2e/{hr,employee}`
(`scripts/ci/load-e2e-logins.py` loads them in CI). `E2E_HR_GIVEN_NAME`
defaults to the seeded HR first name, Thandi.

### Journey tests

`support/journey-harness.ts` runs the journey as its own Playwright
process with the journeys config, normal and help mode, against the app this
run serves, through a small local proxy that can add a recorder, a forbidden
request or a renamed button to the page. It puts `help/media` back as it was.
These tests run once (in `desktop-1280`) and check the journey's desktop and
phone runs themselves. They need `ffmpeg`, `ffprobe`, ImageMagick `compare`
and `python3`, like the help retake workflow.

### Shared fakes

Pages that read one person (ONB-12 on) get them from
`support/documents-fake.ts`: it answers
`GET <documentUploadApiUrl>/v1/employees/<id>/verifications` in the browser. People
and documents are given as they are stored; the fake works out `check` and
`hr_decision` with the card's tables, the same functions the Lambda is held to.

No test calls Bedrock or any paid AI: `support/fixtures.ts` refuses AI routes and
AWS AI hosts in the browser in both runs.
