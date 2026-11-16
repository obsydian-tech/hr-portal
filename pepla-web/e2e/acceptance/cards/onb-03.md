# ONB-03

Card: ONB-03 Add a new employee (NH-169)

Test files: `onb-03.spec.ts`, `support/onb-03/`, and the shared `support/employees-fake.ts` (additive change, see below)

Spec: [NH-169](https://obsydian.atlassian.net/browse/NH-169)

Locks: acceptance-lock/onb-03, acceptance-lock/onb-03.1, acceptance-lock/onb-03.2, acceptance-lock/onb-03.3, acceptance-lock/onb-03.4

AC-1 to AC-7 run at 1280 and 390 wide with no backend. `support/onb-03/registration-fake.ts` (a
subclass of the shared `EmployeesFake`) answers `GET /v1/hr-partners`, `GET /v1/employees/email-check`
and `POST /v1/employees` the way the card says the Lambdas will, and records every call, its body and
its headers. The person who is registered joins the list `GET /v1/employees` answers, in stage
INVITED, with the HR partner's name and email taken from the partners list by `hr_staff_id` and never
from the body. The same Idempotency-Key gets the first answer again and no second person. Cognito is
the shared fake.

AC-8 to AC-11 run the real `lambda/createEmployee`, `lambda/getHrPartners` and
`lambda/checkEmployeeEmail` handlers, each in a fresh Node process (a cold Lambda), against a fake AWS
(`support/onb-03/fake-aws`, from ONB-09's): DynamoDB with the email index, KMS, EventBridge, Step
Functions, Postmark, and a Cognito user pool that answers `ListUsersInGroup` 60 users a page with a
`NextToken` (a Limit over 60 is refused, as Cognito refuses it). Any AI client import fails the run.
Nothing reaches AWS. These run once (in `desktop-1280`).

AC-12 reads `infra/*.tf`, the Lambda folders, `lambda/shared` and `api/openapi.yaml` as text. Only
createEmployee's role policy is compared with `support/onb-03/iam.create-employee.0841faa.tf.txt` (the
policy as it was at 0841faa): it gains exactly one line, `cognito-idp:ListUsersInGroup` on the pool.
`support/onb-03/openapi_params.py` and ONB-15's `openapi_route.py` read the spec (python3 and PyYAML).

AC-13 runs on pepla-dev (desktop only, once): the employee login gets 403 from all three routes, and HR
registers one person with an address at `blackhole.postmarkapp.com` and finds them Invited. It is
skipped in the no-backend run, and red until the card is merged and deployed to pepla-dev.

## Shared file changed with this card

`support/employees-fake.ts` changed, additively only, so the subclass can answer more routes: CORS now
allows `idempotency-key` and `POST`, `JWT` and `json` are exported, `appOrigin` and `handle` are
`protected`, and a new `protected matches(url)` names the URLs the fake answers (`install` uses it).
Nothing the earlier cards rely on behaves differently.

## The ID number (AC-4)

The ID number field is optional and was in the spec. To drop it, delete the two tests whose names start with
"AC-4", the `id_number` cases in AC-9 and AC-12's `id_number` lines, and the `id: true` option in the
AC-6 and AC-7 fill steps. Nothing else changes.

## Re-lock onb-03.4 (ONB-04, 16 Nov 2026)

ONB-04 replaces the emailed password with an invite link. createEmployee now reads two more settings and
writes a row in `employee_invites` on every registration, so three lines changed here, and nothing else:
`support/onb-03/lambda-harness.ts` sets `COMPANY_NAME` and `APP_URL`; `support/onb-03/fake-aws/world.mjs`
knows the `employee_invites` table and its `employee-index`; AC-12 leaves out of its createEmployee policy
comparison the lines that are ONB-04's to judge (`AdminSetUserPassword` removed, invite table lines added).
