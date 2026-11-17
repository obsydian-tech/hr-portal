# TEN-05

Card: TEN-05 One sign-in pool with five roles, every group in Terraform (NH-197, epic NH-192 Tenancy)

Test files: `ten-05.spec.ts` and `support/ten-05/`, plus the TEN-05 groups in `be-16.spec.ts` AC-4 and AC-5

Spec: [NH-197](https://obsydian.atlassian.net/browse/NH-197)

Lock: acceptance-lock/ten-05 (AC-1 to AC-9; be-16.spec.ts is re-locked in the same commit)

Nothing here opens the app. The Lambda tests run the real handlers, each call in a fresh Node process (a cold
Lambda), against `support/ten-05/fake-aws`: a copy of TEN-03's fake AWS with code added only. It adds
`AdminRemoveUserFromGroup` and `AdminDisableUser`, and a pool may list its groups (`world.cognito.groups`), so adding
a user to, removing from or listing a group that does not exist fails as in AWS. Any AI client fails, and outbound
HTTP is refused. The world is in `support/ten-05/world.ts` (companies A and B from TEN-03, three pool users, the
group lists). The callers and the expected answer per route are in `support/ten-05/access.ts`. What develop 1420ef9
answers each old caller is frozen in `support/ten-05/baseline-1420ef9.json`. These run once, in `desktop-1280`.

Pinned by the verifier (the reasons are in `TEN-05-refresh.md` and `TEN-05-tests-for-review.md`):

- P1 `lambda/shared/roles.mjs` is the one file that names a group. `rolesOf(event)` answers
  `{ roles, perms }` with the group names; `requireRole(event, { roles, perms })` answers null or 403
  `{"error":"Forbidden"}`; `OLD_GROUPS` maps today's names until TEN-06.
- P2 HR stays `hr_staff` only: `naleko-onboarding-hr` gives nothing, `naleko-talentflow-hr` and `HRDirector` give
  `perm-recruitment` only. `hrOnly` keeps its answers.
- P3 Same access means no loss: no old-group caller loses anything develop gives it. Gains are allowed and listed.
- P4 Per-route lists as in `access.ts`. Finishing someone else's IT task and seeing every IT queue stays with `admin`
  or today's `ITAdmin` group.
- P5 The role check comes before the company check and before any AWS call. The admin routes need a company.
- P6 User admin body: `{ role, permissions }` with the new names, or today's `roles`. Update removes the eight new
  groups and today's four managed TalentFlow names, never `e2e-robots` or `naleko-*`. Create stamps the caller's
  company. Another company's user is 404.
- P7 No tenants table read yet (no Member row, pickers not narrowed by company): the grant is owed. A later card
  re-locks those lines.
- P8 The three user admin role policies stay as develop has them, and no Cognito action has a `*` resource.
- P9 The company comes from the token only. An `x-tenant-id` header or a `tenant_id`, `tenantId` or `company` query
  value changes nothing on the user admin routes or the pickers (AC-5, AC-6).

- AC-4 and AC-8 read code and Terraform as text. AC-7 compiles `deriveModules` from `auth.service.ts`.
- AC-9 runs on pepla-dev only (@pepla-dev). It needs `scripts/tenancy/ten-05-dev-count.json` (`{"candidates": n}`,
  recorded by the merger before the dev apply) and `E2E_IT_EMAIL`, `E2E_IT_PASSWORD`, `E2E_GUEST_EMAIL`,
  `E2E_GUEST_PASSWORD`. Until then it is skipped with a note.

Expected red before the build: all except the Control test and AC-8, which guard today's behaviour.

`be-16.spec.ts` AC-4 and AC-5: the seed may now put test logins in the six TEN-05 groups, so the fake dev pool has them.
Nothing else in be-16 changes.
