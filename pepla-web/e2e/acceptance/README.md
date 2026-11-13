# Acceptance tests

One Playwright test per acceptance criterion of a card, named after it
("AC-3 HR signs in ..."). They are written from the card, before the code, by
the verifier, not by the person who builds the feature. They fail until the
feature is built.

| Card | File | Spec |
| --- | --- | --- |
| ONB-01 HR signs in (NH-147) | `onb-01.spec.ts` | [ONB-01 card](https://claude.ai/artifact/6CCqqjLxwN6Jtt2szsKjZC) |
| ONB-01.1 Sign-in says Email (NH-148): AC-1, AC-2, AC-11 changed, AC-13 new | `onb-01.spec.ts` | [ONB-01.1 card](https://claude.ai/artifact/C6mTFVtoRw4AGnYNVVCuNp) |
| HELP-01 Help pictures: HR signs in (NH-149) | `help-01.spec.ts` | [HELP-01 card](https://claude.ai/artifact/2ymwurnoSSuNJZFDZi4VUN) |
| OPS-02 Dev test run starts after app-only merges (NH-152): checks the workflow files | `ops-02.spec.ts` | [OPS-02 card](https://claude.ai/artifact/RcgsQNdSreMKuSwNJp76BZ) |
| BE-16 Sign-in groups set up by Terraform (NH-151) | `be-16.spec.ts` | [NH-151](https://obsydian.atlassian.net/browse/NH-151) |
| HELP-01.2 HR home in the help pictures shows Sunbird Bakery's new employees (with ONB-02) | `support/journey-harness.ts` | ONB-02 spec, Decision 1 |
| ONB-02 HR home: who is starting (NH-155) | `onb-02.spec.ts` | [NH-155](https://obsydian.atlassian.net/browse/NH-155) |
| ONB-12 One new employee's page (NH-156) | `onb-12.spec.ts` | [NH-156](https://obsydian.atlassian.net/browse/NH-156) |
| HELP-01.3 Release PRs into main skip the AC-10 help pictures rule (NH-157) | `help-01.spec.ts` | [NH-157](https://obsydian.atlassian.net/browse/NH-157) |

## Locked

Once Iggie accepts a card's tests, a lock branch `acceptance-lock/<card>` is
pushed pointing at the commit that adds them (a later accepted change gets
`acceptance-lock/<card>.2`, and so on).
The `Acceptance tests locked` check (`.github/workflows/acceptance-lock.yml`)
fails a PR if any other commit changes this folder. A test that looks wrong goes
back to the verifier, and to Iggie if the criterion itself changes.

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

### Cards about a journey or its help pictures

`help-01.spec.ts` checks a journey (`e2e/journeys/*.e2e.ts`) rather than a
page. `support/journey-harness.ts` runs the journey as its own Playwright
process with the journeys config, normal and help mode, against the app this
run serves, through a small local proxy that can add a recorder, a forbidden
request or a renamed button to the page. It puts `help/media` back as it was.
These tests run once (in `desktop-1280`) and check the journey's desktop and
phone runs themselves. They need `ffmpeg`, `ffprobe`, ImageMagick `compare`
and `python3`, like the help retake workflow.

### Cards about workflows

`ops-02.spec.ts` checks `.github/workflows/` rather than a page.
`support/ops-02-workflows.ts` reads the workflows with python3 and PyYAML,
applies GitHub's path filter rules to sample file lists, and runs the real
"post results" step of `app-e2e-dev.yml` on the sample results in
`support/ops-02/` with a fake GitHub API. These tests run once (in
`desktop-1280`), open no page and call nothing outside the machine.

### Infra cards

`be-16.spec.ts` checks an infra card, so it opens no browser and runs once (in
`desktop-1280`). `support/infra-harness.ts` reads the Terraform files as text,
runs a `scripts/ci` script against a fake AWS (`support/be-16/fake-aws`, a
stand-in `boto3` that records every call and never reaches AWS), and runs one
step of a workflow with a stub `terraform` and made-up plans. What only real
AWS can show (the prod plan on the PR, the pepla-dev apply) is read by the
verifier on the second pass. Needs `python3`, `jq` and `bash`.

Pages that read one person (ONB-12 on) get them from
`support/documents-fake.ts`: it answers
`GET <documentUploadApiUrl>/v1/employees/<id>/verifications` in the browser. People
and documents are given as they are stored; the fake works out `check` and
`hr_decision` with the card's tables, the same functions the Lambda is held to.

### Cards that change a Lambda

`onb-12.spec.ts` AC-5 and AC-11 run the real `lambda/getEmployeeDocumentVerifications`
handler in its own Node process against a fake AWS (`support/onb-12/fake-aws`):
every AWS SDK and Powertools import is answered by a fake, the tables come from
made-up people, and every DynamoDB and KMS call is recorded. Nothing is installed
in the Lambda folder and nothing reaches AWS; importing an AI client fails the run.
They run once (in `desktop-1280`). `support/onb-12/openapi_route.py` reads
`api/openapi.yaml` (python3 and PyYAML).

No test calls Bedrock or any paid AI: `support/fixtures.ts` refuses AI routes and
AWS AI hosts in the browser in both runs.
