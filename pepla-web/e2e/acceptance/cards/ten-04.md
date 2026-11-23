# TEN-04

Card: TEN-04 Every route described, and a company B walk that proves nothing of company A leaks (NH-196, epic NH-192 Tenancy)

Test files: `ten-04.spec.ts` and `support/ten-04/`

Spec: [NH-196](https://obsydian.atlassian.net/browse/NH-196)

Locks: acceptance-lock/ten-04

Nothing here calls AWS or any AI in the no-backend run. AC-1 to AC-4 run the builder's
`scripts/ci/routes-match-openapi.mjs --root <dir>` against planted copies of Terraform, `api/openapi.yaml`, the Lambda
sources and `lambda/shared/tenant-retrofit.json` (a fresh temporary copy per fault). AC-5 and AC-6 read the file. AC-7
runs the walk (`support/ten-04/walk.ts`) against a model of the API (`model.ts`) in the no-backend run, once with a
correct API and once per planted leak, and on pepla-dev over HTTP (@pepla-dev). All run once, in `desktop-1280`.

Pinned by the verifier (the reasons are in `TEN-04-tests-for-review.md`):

- P1 The script is run as `node scripts/ci/routes-match-openapi.mjs [--root <dir>]`; exit 0 means passed; every problem line
  names the route key as Terraform has it, or the Lambda folder name for a retrofit entry.
- P2 A route's handler is found through its integration (`integration_uri` `aws_lambda_function.<L>.invoke_arn`, or `data.`),
  the function's `function_name` (a string, or `local.<name>` holding a string) and the folder `lambda/<function_name>/`.
- P3 A route key in the file is the Terraform key, parameter names included.
- P4 `security` is `[{CognitoJWT: []}]` for a JWT route, `[{AgentKey: []}]` for a CUSTOM route, `[]` for a route with no
  authorization. `x-tenant` is `token`, `agent`, or (public) `stored-record` or `none`. `x-roles` is a list of the TEN-05
  role and tick names (any one lets a caller in); `[]` means any signed-in person, the agent key, or a public route.
- P5 Every operation names its API with `servers` (on the operation or its path); the four APIs have four addresses.
- P6 Terraform has seven public routes, not six: `GET /v1/employees/lookup` is the seventh (x-tenant `stored-record`).
- P7 A route added after this lock gets its walk row in `scripts/tenancy/ten-04-rows.json` (outside the locked folder), so no
  later card re-locks this one.
- P8 Existing operations are compared with `support/ten-04/openapi.baseline.json` (develop 6122df1): same keys, same values
  (examples apart), new keys and new response codes allowed.
- P9 The walk's logins and rows: `E2E_TF`, `E2E_TF_B`, `E2E_IT_B`, `E2E_VICTIM` are new (seed, `load-e2e-logins.py`); company A's
  walk rows have the ids in `support/ten-04/dev-ids.json`; the walk's own records carry `e2e.run-ten04` so the existing
  cleanup removes them.

`AC-7 The company B walk on pepla-dev` needs `E2E_AGENT_API_URL` (no path), `E2E_AGENT_KEY`, and the TalentFlow API address
(`E2E_TF_API_URL`, or `hr-portal/src/environments/environment.ts` `talentFlow.apiUrl`).

Expected red before the build: every test except the Control, AC-5 and the walk-row coverage test.

## Child lock ten-04.9 (REC-14 step B)

`ten-04.2.spec.ts` AC-5 and AC-8: hiring managers come from `lambda/shared/hiring-managers.mjs` (rec-14.2 AC-5). A person with no
Member row is nobody's, also while `LEGACY_TENANT_ID` names the company (REC-14 rule 12; prod catch-up P-4). The text check reads
the Member rows and the missing-group warning in the shared file. Panel members (AC-4, AC-6) are as they were.
