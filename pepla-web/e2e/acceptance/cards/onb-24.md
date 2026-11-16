# ONB-24

Card: ONB-24 Forgot your password (NH-188)

Test files: `onb-24.spec.ts`, `support/onb-24/` (Lambda harness and fake AWS, Terraform checks, baselines),
with additive changes to `support/cognito-fake.ts` and a one-line change to `support/fixtures.ts`

Spec: [NH-188](https://obsydian.atlassian.net/browse/NH-188)

Locks: acceptance-lock/onb-24

Anyone with a password resets it from the sign-in page: "Forgot your password?", their email, a 6-digit
code by email, then the code and a new password. The page reads the same whether or not the email has an
account. The code email goes through Postmark from a Cognito custom email sender Lambda, and a post
confirmation Lambda signs the person out everywhere after the change.

AC-1 to AC-10 run at 1280 and 390 wide with no backend (the AC-10 phone test at 390 only; the AC-1 source
check, AC-11 and AC-13 once, at 1280). AC-11 runs `lambda/cognitoEmailSender` and
`lambda/cognitoPostConfirmation` in a fresh Node process each against `support/onb-24/fake-aws` (the AWS
Encryption SDK, SSM, DynamoDB, Cognito, CloudWatch, Powertools and Postmark, by package or by fetch). The
Lambda tests live here rather than next to the Lambdas so the lock covers them. AC-12 is the pepla-dev
check (desktop once there): red until this card is merged and deployed. It reads the code from the dev sink
table with the AWS CLI and the dev E2E job's role. AC-13 reads `infra/` and `pepla-web/src` as text, against
develop at f56421a (`support/onb-24/*.f56421a.*`).

An extra AC-9 test folds in the ONB-23 security review's probes (findings L-1 and L-2): an employee lands on
`/start` whatever the returnUrl, and HR follows a returnUrl only to an HR page on this origin.

## Shared files changed with this card

- `support/fixtures.ts`, one line: `SignInPage.forgot` is now the link "Forgot your password?" (it was the
  footer line "Forgot your password? Your Admin can send you a new link."). ONB-01 AC-1 and HELP-01 AC-4 use
  it; the link sits where the line sat, under the Sign in button. Iggie saw this before the lock.
- `support/cognito-fake.ts`, add only: `ForgotPassword` and `ConfirmForgotPassword` as the real pool answers
  them with PreventUserExistenceErrors on, `failNext`, `hold`, `codeFor`, `expireCode` and `callsTo`. A
  password set by a reset is checked for real at sign-in (SRP); every other account signs in as before.

## Changed with BE-17.1 (lock onb-24.2)

AC-13's pool check also leaves out `user_attribute_update_settings` (BE-17.1's change to the same pool,
checked by be-17.1.spec.ts AC-4). Nothing else changes.
