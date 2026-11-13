# Acceptance tests

One Playwright test per acceptance criterion of a card, named after it
("AC-3 HR signs in ..."). They are written from the card, before the code, by
the verifier, not by the person who builds the feature. They fail until the
feature is built.

| Card | File | Spec |
| --- | --- | --- |
| ONB-01 HR signs in (NH-147) | `onb-01.spec.ts` | [ONB-01 card](https://claude.ai/artifact/6CCqqjLxwN6Jtt2szsKjZC) |

## Locked

Once Iggie accepts a card's tests, the commit that adds them is tagged
`acceptance/<card>` (a later accepted change gets `acceptance/<card>.2`, and so on).
The `Acceptance tests locked` check (`.github/workflows/acceptance-lock.yml`)
fails a PR if any other commit changes this folder. A test that looks wrong goes
back to the verifier, and to Iggie if the criterion itself changes.

Builders: bring `develop` in with a merge, not a rebase. A rebase rewrites the
tagged commits and the check fails.

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

```sh
ACCEPTANCE_TARGET=pepla-dev E2E_BASE_URL=http://localhost:4200 \
  E2E_HR_EMAIL=... E2E_HR_PASSWORD=... E2E_EMP_EMAIL=... E2E_EMP_PASSWORD=... \
  npm run e2e:acceptance                   # pepla-dev run: tests tagged @pepla-dev only
```

The pepla-dev run expects the app already running against pepla-dev, and the
seeded test logins from Secrets Manager `pepla-dev/e2e/{hr,employee}`
(`scripts/ci/load-e2e-logins.py` loads them in CI). `E2E_HR_GIVEN_NAME`
defaults to the seeded HR first name, Thandi.

No test calls Bedrock or any paid AI: `support/fixtures.ts` refuses AI routes and
AWS AI hosts in the browser in both runs.
