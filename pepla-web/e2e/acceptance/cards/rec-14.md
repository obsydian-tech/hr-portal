# REC-14 step A: departments store (tests)

Spec: /mnt/project-files/onboarding-cards/specs/REC-14.md (rules 1 to 9, AC-1 to AC-4). Review page: onboarding-cards/specs/REC-14-tests-for-review.md.
Step 0 facts: onboarding-cards/specs/REC-14-facts.md. Tests: pepla-web/e2e/acceptance/rec-14.spec.ts, support/rec-14/.

## Locks

- `acceptance-lock/rec-14`: rec-14.spec.ts and support/rec-14 (step A only). Steps B to D get their own tests later as rec-14.2 and on.
- `acceptance-lock/rec-14.1` (child lock): older locked tests make room for manageDepartments: chat-15 AC-12, mod-01 AC-6 and AC-8,
  mod-02 AC-8, onb-22 AC-8, rec-02 AC-11, rec-04 AC-8, ten-02 AC-13, ten-03 AC-10.
- `acceptance-lock/ten-04.8` (child lock): the walk's `department` kind (support/ten-04/rows.ts), its dev id (support/ten-04/dev-ids.json)
  and both walk worlds (ten-04.spec.ts).
- The builder merges all three lock branches, never copies them.

## Questions taken on the spec's recommended option (logged, Iggie can change them)

- Q-2: Admin only changes the list; HR staff, Admins and Recruiters read it.
- Q-3: the screen is a later card (a Departments section on Tenant settings); step A builds routes only.
- Q-4: onboarding moves to the same list in follow-up F-2; nothing in step A touches Register an employee.
- Q-1 was decided by Iggie: Engineering, Finance, Operations, People.

## Decisions the tests pin where the spec is silent (D-T-1 to D-T-15, for the BA to confirm)

See the header of rec-14.spec.ts. The ones a builder is most likely to trip on:
- D-T-6 exact error bodies, including `field` on INVALID_FIELD.
- D-T-9 the Idempotency-Key row lives under the company's own `DEPARTMENTS#` keys, in the same transaction.
- D-T-12 in set-modules, the department seed runs before the flip; the throwaway build runs it after the module seeds, so a failing module seed still writes nothing (mod-01 AC-6).
- D-T-13 seed-dev.py does not start node (be-16 AC-4 runs it with a fake boto3 only); it reads the starting names from the seed file.
- D-T-14 the walk POST sends no Idempotency-Key, so it answers 400 and writes nothing to company B on dev (no slow climb to the 200 cap).
- D-T-16 (lock check round 2) a list that exists with every department archived is still a list: the seed, the module script and seed-dev.py leave it as it is (nothing written, version unchanged). Every read of a list by the seed and seed-dev.py is a consistent read.
- D-T-15 the PII key: read list once (BE-18), never the encrypt list, though spec rule 6 says "encrypt and decrypt".

## Notes for the builder

- The throwaway build that passes every test is in /mnt/project-files/onboarding-cards/rec-14/throwaway-build.patch. It is a guide, not the answer.
- `npm install -D ajv@8.20.0` in pepla-web (updates the lock file too); the throwaway only touched package.json.
- The employees API CORS gains PATCH (apigateway.tf).
- No tests type-check here (the repo has no @types/node for the acceptance folder); Playwright runs them.

## Step B: options and the role rule (tests)

Spec rules 10 to 15 (AC-5, AC-6, the Lambda half of AC-7). Tests: `rec-14.2.spec.ts`, `support/rec-14.2/` (world on REC-04's and
REC-14's, and `world-patch.mjs`, a preload that lets a test fail Cognito calls). Review page: onboarding-cards/specs/REC-14-step-B-tests-for-review.md.

### Locks

- `acceptance-lock/rec-14.2`: rec-14.2.spec.ts, support/rec-14.2, this note. Steps C and D get rec-14.3 and on.
- `acceptance-lock/rec-04.2` (child): rec-04 opens a role with `department_id`.
- `acceptance-lock/ten-04.9` (child): ten-04.2 AC-5 and AC-8 follow the shared hiring manager function; scripts/tenancy is the builder's (the walk row for the options route is data, in `scripts/tenancy/ten-04-rows.json`).
- `acceptance-lock/ten-05.5` (child): ten-05 AC-4 for getHiringManagers.
- The builder merges all four lock branches, never copies them.

### Decisions the tests pin where the spec is silent (D-T-B1 to D-T-B9, for the BA to confirm)

See the header of rec-14.2.spec.ts. The ones a builder is most likely to trip on:
- D-T-B1 the options answer has exactly six keys; `panel_size_by_level` is the company's map, `screening` its switch, each falling back on the REC-12 default.
- D-T-B4 any failed read (departments, settings, Member rows, sign-in pool) is 500 `{error:'Something went wrong'}`, never a shorter list.
- D-T-B5 the hiring manager rule: CONFIRMED, enabled, one Member row that is this company's; no legacy fallback; every page of every group; name order ignoring case.
- D-T-B6 any department that is not offered (archived, another company's, made up, missing) is 400 INVALID_DEPARTMENT, nothing written.
- D-T-B7 `department` in an answer is the current name of `department_id`; an old role keeps its text and has no `department_id`.
- D-T-B8 `RoleOptions` and `Role` are closed schemas in api/openapi.yaml; `GET /v1/config` has `configType` required.

### Notes for the builder

- The throwaway build that passes every test: /mnt/project-files/onboarding-cards/rec-14/throwaway-build-B.patch. A guide, not the answer.
- The new route needs its Terraform resource (talent-flow-roles.tf) and a company-walk row (ten-04-rows.json).

## Step C: the Open a role page and the board (tests)

Spec rules 16 to 24 (the UI half of AC-7, AC-8, AC-9, AC-10, AC-12, AC-13). Tests: `rec-14.3.spec.ts`. The fake API is the shared
Recruitment harness (`support/rec-ui/harness.ts`), changed in the child lock rec-ui-01.2. Review page:
onboarding-cards/specs/REC-14-step-C-tests-for-review.md.

### Locks

- `acceptance-lock/rec-14.3`: rec-14.3.spec.ts and this note. Step D gets rec-14.4 and on.
- `acceptance-lock/rec-ui-01.2` (child): the harness reads `world.options` (one `GET /v1/roles/options` answer, checked against
  api/openapi.yaml `RoleOptions` at load), refuses routes and missing required query parameters the file does not have, checks
  every rule 14 answer and the `POST /v1/roles` body, and fails a test with `contractErrors`; rec-ui-01 AC-3 and AC-4 follow it.
- The builder merges both lock branches, never copies them.

### Decisions the tests pin where the spec is silent (D-T-C1 to D-T-C8, for the BA to confirm)

See the header of rec-14.3.spec.ts. In short: placeholders "Choose a department" and "Choose a hiring manager" (the design system
select's own placeholder); nothing can be sent while the options call is out; W-1 is a danger section message with Try again and no
form; W-2 and W-3 are text on the form; after a 400 or 409 the options are read once more and the next attempt gets a new key; the
types come from `npm run api:types` (openapi-typescript on ../api/openapi.yaml into src/app/core/api/openapi.d.ts) and a workflow
checks the file is current with `git diff --exit-code`; no `HireConfig` is left; a wrongly shaped options answer shows W-1.

### Notes for the builder

- openapi-typescript 7 asks for TypeScript 5 as a peer; pepla-web has TypeScript 6. An `overrides` entry
  (`"openapi-typescript": { "typescript": "$typescript" }`) lets `npm ci` pass. Throwaway build:
  /mnt/project-files/onboarding-cards/rec-14/throwaway-build-C.patch (a guide, not the answer).
- AC-12 on pepla-dev uses E2E_TF as the Admin login and E2E_MANAGER as the seeded hiring manager: the dev acceptance step needs
  both in its environment (scripts/ci/load-e2e-logins.py already maps them).
- The real `GET /v1/roles` and `GET /v1/roles/{id}` answers have no `hiring_manager_name` and give criteria as `{ key, label }`;
  the Roles list fake still sends the name. That drift is outside rule 14 (follow-up F-3).
