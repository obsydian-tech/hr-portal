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
