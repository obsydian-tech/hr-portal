# REC-15 step B: add a candidate to an open role (tests)

Jira: NH-266 (parent NH-234). Spec: /mnt/project-files/onboarding-cards/specs/REC-15.md, Part 3 (rules 19 to 23), AC-7, AC-8, AC-9, the
add half of AC-16 and step B's lines of AC-17. Review page: onboarding-cards/specs/REC-15B-tests-for-review.md.
Tests: pepla-web/e2e/acceptance/rec-15b.spec.ts, support/rec-15b/. Build branch: feat/rec-15-b-add-candidate.

The step A notes (cards/rec-15.md) said later steps would be rec-15.2 and on. Step B's lock is named `acceptance-lock/rec-15b` instead, as
the card asked; steps C and D may follow either form, as long as the name is checked free first.

## Locks

- `acceptance-lock/rec-15b`: rec-15b.spec.ts, support/rec-15b (the IAM baseline of develop 7dcca4d) and this file.
- `acceptance-lock/rec-15b.1` (child lock, on top): older locked tests make room for the new body and the one new grant.
  - support/rec-15b.1/: the open role per company and the new body the older suites send (roles.ts), the grant allowance (grants.ts), and
    TEN-03's "company B named outside the body" helper (company.ts).
  - rec-01, ten-03, mod-01 routes and worlds: POST /v1/candidates sends the rule 19 body for an open role of the caller's company; the
    worlds hold that role, ROLES_TABLE_NAME, and their fake AWS knows the roles table's key (pk, sk).
  - rec-12 AC-3 and the AC-9 dev check: the new body (dev: the seed's open Fleet controller role).
  - rec-03 AC dev check: the new body on the seed's Senior accountant role (its hiring manager is the manager login, as the old body's
    hiringManagerId was), with the key in the Idempotency-Key header.
  - ten-03 AC-4: company B is named in the query and headers, not the body (a body naming a company is now 400 INVALID_FIELD, checked).
  - rec-01 AC-8, mod-01 AC-8, ten-03 AC-10, rec-04 AC-8, rec-07 AC-9, rec-15 AC-17: createCandidate may gain exactly the GetItem line on
    talent-flow-roles.
  - rec-14's fake EventBridge can now be told to fail a send (`world.fail = { service: 'events' }`), as the DynamoDB fake can. Add-only:
    no older test sets it.
  - These lines fail on today's develop on purpose (the old Lambda refuses the new body): rec-01 Control and AC-2 (Recruiter-only),
    mod-01 AC-2, rec-12 AC-3, ten-03 Control and AC-4.
- The builder merges both lock branches, never copies them.

## Decisions the tests pin where the spec is silent (D-T-B1 to D-T-B12, for the BA to confirm)

Full list in the header of rec-15b.spec.ts. The ones a builder is most likely to trip on:
- D-T-B1 refusal bodies and codes: INVALID_FIELD with `field`, ROLE_REQUIRED, IDEMPOTENCY_KEY_REQUIRED, INVALID_BODY; 404 { error: 'Not found' }
  for another company's role and a made-up id alike; 409 { error: 'Conflict', code: 'ROLE_CLOSED' }.
- D-T-B5 the answer's `candidate` equals the row GET /v1/candidates gives the same caller.
- D-T-B6 header key wins over body key. D-T-B7 a replay answers the first answer even after the role closed.
- D-T-B10 a failed role read holds no key; after any failure that stored no candidate the same key works again (round 1, D-1).
- D-T-B12 every AWS call is one createCandidate's role may make (no UpdateItem, DeleteItem, Scan, Batch or Transact).
- D-T-B11 one new grant (GetItem on talent-flow-roles) and ROLES_TABLE_NAME on the Lambda.

## Notes for the builder

- The throwaway build that passes every test: /mnt/project-files/onboarding-cards/rec-15b/throwaway-build-B.NOT-FOR-MERGE.patch. A guide only.
- Keep `lambda/createCandidate/index.js` importing `../shared/recruitment-settings.mjs` (REC-12 AC-8 reads that import as text).
- Run `npm run api:types` in pepla-web after the openapi change.
- createCandidate's role has GetItem and PutItem on the idempotency table, never UpdateItem or DeleteItem. The tests check every AWS call
  an add makes against the role (D-T-B12), so mark the key finished and free it with PutItem. Lock check round 1, D-1 (decided): after any
  failure that stored no candidate, the same key must work on the next try; the throwaway marks the key FAILED with a PutItem and lets a
  FAILED key be taken again (conditional put `attribute_not_exists(idempotencyKey) OR status = FAILED`). No new grant.
- A failed event send does not fail the add (rule 23, best effort as today).
- The new GetItem grant on talent-flow-roles goes inside the existing `aws_iam_role_policy.create_candidate` statement list. A separate
  policy resource passes rec-15b but fails the older IAM checks, whose allowance is keyed to that one policy (lock check N1).
- ten-02 AC-12 runs `npm test` in lambda/shared: run `npm ci` there first on a fresh machine.
