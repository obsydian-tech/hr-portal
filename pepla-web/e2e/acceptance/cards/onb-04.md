# ONB-04

Card: ONB-04 Invite link instead of a password (NH-170)

Test files: `onb-04.spec.ts` and `support/onb-04/`

Spec: [NH-170](https://obsydian.atlassian.net/browse/NH-170)

Locks: acceptance-lock/onb-04

There is no screen: ONB-17 builds the set-password page. AC-1 to AC-10 and AC-13 run the real
`lambda/createEmployee`, `lambda/lookupInvite` and `lambda/redeemInvite` handlers and
`lambda/shared/invite.mjs` (`issueInvite`, called directly as ONB-18 will), each in a fresh Node process,
against `support/onb-04/fake-aws` (ONB-03's fake AWS, copied, plus):

- the `employee_invites` table (key `token_hash`, index `employee-index` on `employee_id`);
- a Cognito user status: `AdminCreateUser` leaves the person in `FORCE_CHANGE_PASSWORD` with no password of
  ours, `AdminSetUserPassword` checks the pool's rules (12+, lower, upper, number, symbol) and refuses a weaker
  one as Cognito does, and `world.cognitoFail` makes an operation fail with a 500;
- a fixed clock (`ONB04_NOW`), so 7 days can pass between two runs;
- every `console` line recorded with the Powertools logger's lines, so a test can search all logs;
- two requests that run at the same moment in one process (AC-8), with every DynamoDB and Cognito call
  waiting one turn of the event loop, so they really interleave.
- `UpdateItem` honours `ReturnValues` `UPDATED_NEW` and `UPDATED_OLD` (the attributes the expression names), and a
  failed condition honours `ReturnValuesOnConditionCheckFailure: 'ALL_OLD'`, as DynamoDB does.

The Lambdas get `COMPANY_NAME` ("Sunbird Bakery"), `APP_URL` (`http://localhost:4300`) and the table name
`employee_invites` (also as `INVITES_TABLE`). These run once, in `desktop-1280`. Nothing reaches AWS, Postmark
or any AI service.

AC-11 reads `infra/**/*.tf` (modules included), the Lambda folders, `scripts/ci/cleanup-dev-e2e.py`,
`api/openapi.yaml` and `lambda/serveDocs/spec.yaml` as text. createEmployee's role is compared with
`support/onb-04/iam.create-employee.ae7bba4.tf.txt` (the policy as it was at ae7bba4): it loses exactly
`AdminSetUserPassword` and gains exactly PutItem, UpdateItem and Query (index) on the invite table. The table's
Terraform resource label must be `employee_invites` too, because ONB-03 AC-12 (re-lock onb-03.4) recognises the
invite-table lines by that name. The `InviteFailed` metric filter must match the error line createEmployee really
logs when Cognito fails (AC-11 runs createEmployee and applies the pattern to its log lines), and no line of a good
registration.

AC-12 renders the email's HTML at 1280 and 390 wide. The AC-5 test tagged `@pepla-dev` runs on pepla-dev
only (desktop, once) and is red until the card is merged and deployed.

AC-13 (added 16 Nov 2026, Iggie): five refused passwords on one link close it.

## Shared files changed with this card

None of ONB-04's files are shared. ONB-04 changes what createEmployee needs (two settings, an invite row
per registration), so ONB-03's Lambda fake needed the same, under ONB-03's own re-lock `onb-03.4`
(see `cards/onb-03.md`).
