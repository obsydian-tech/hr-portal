# TEN-06

Card: TEN-06 TalentFlow people move to the one sign-in pool, silently (NH-198, epic NH-192 Tenancy)

Test files: `ten-06.spec.ts` and `support/ten-06/` (fake AWS with two sign-in pools, the Lambda harness and two
baseline Terraform files)

Spec: [NH-198](https://obsydian.atlassian.net/browse/NH-198)

Locks: acceptance-lock/ten-06 (AC-1 to AC-7, step 1, the switch). AC-8 runs on pepla-dev only. AC-9 (the reminder
script, step 2, 60 days after the prod switch) is deferred to acceptance-lock/ten-06.1. Locked specs of other cards that
had to change are re-locked in the same commit, each under its own lock name pointing at the same commit (listed in the
review page).

Nothing here opens the app. The Lambda tests run the real handlers (`userMigration`, `tenantPreToken`,
`cognitoPostAuth`, and 22 TalentFlow, IT and bundle handlers), each call in a fresh Node process, against
`support/ten-06/fake-aws`: a copy of TEN-05's fake AWS with code added only. It adds a second sign-in pool (the
TalentFlow pool, chosen by `TALENT_FLOW_POOL_ID`, the Naleko pool by `COGNITO_POOL_ID`) that answers
`AdminInitiateAuth` with `ADMIN_USER_PASSWORD_AUTH`, `AdminGetUser`, `AdminListGroupsForUser` and `ListUsers`.
A recorded sign-in never keeps the password. Any AI client fails and outbound HTTP is refused. These run once, in
`desktop-1280`.

Pinned by the verifier (the reasons are in `TEN-06-tests-for-review.md`):

- Names: Lambda `userMigration` (`lambda/userMigration/index.mjs`), role `naleko-userMigration-role`, a pending row
  `pk MIGRATE#<email>` `sk TENANT#<founding id>` with `legacy_user_id`, `groups`, `created_at` and `expires_at`
  (30 days, a TTL on the tenants table), no `tenant_id` attribute. A Member row is `USER#<sub>` `TENANT#<id>` with
  `legacy_user_id`.
- `lambda/shared/tenant.mjs` exports `userIdOf(event)`: the `user_id` claim, else `sub`, else an empty string. The 22
  handlers that compare the caller to a stored person id use it.
- The migration trigger refuses everything the same way (`Bad username or password`), never throws anything else,
  and logs only `User moved` or `User not moved` with a reason code: no email, name, id or password.
- Pre-token and post-auth never throw and finish in either order with the same rows and groups.
- `scripts/tenancy/link-both-pools.mjs --env dev|prod --tenant <id> --pool <Naleko pool id> --talent-flow-pool <TalentFlow pool id> [--profile x] [--apply|--check]`.
  Dry run by default. It prints counts only, never an address.
- Old app: `environment.ts` and `environment.prod.ts` point `talentFlow.cognitoConfig` at the Naleko pool and client;
  `talent-flow-auth.service.ts` signs in with `USER_PASSWORD_AUTH`; `legacy-claims.ts` (`legacyClaimsOf(groups)`) gives
  today's claims back from the one pool's groups.
- Terraform: `user_migration` in the pool's `lambda_config`, a server-only client `ALLOW_ADMIN_USER_PASSWORD_AUTH`
  without a secret in the TalentFlow stack, the `userMigration` role's exact rights, `cognitoPostAuth` gaining only
  `PutItem` and `DeleteItem` on the tenants table and `AdminAddUserToGroup` on the Naleko pool.
