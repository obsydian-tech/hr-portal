# ONB-04.2

Card: ONB-04.2 An invite never takes over an existing sign-in (NH-191, follows ONB-04 / NH-170)

Test files: `onb-04.2.spec.ts` and `support/onb-04.2/`

Spec: [NH-191](https://obsydian.atlassian.net/browse/NH-191)

Locks: acceptance-lock/onb-04.2

The rule: an invite link may only finish setting up a sign-in that nobody has used yet (Cognito status
`FORCE_CHANGE_PASSWORD`) and that belongs to no group except `employee`. AC-1 to AC-4 run the real
`lambda/createEmployee` and `lambda/redeemInvite` handlers and `lambda/shared/invite.mjs` (`issueInvite`), each in
a fresh Node process, against `support/onb-04.2/fake-aws`: a copy of ONB-04's fake AWS with one addition,
Cognito's `AdminListGroupsForUser`, which answers the groups the fake keeps for each user. The fake already makes
`AdminCreateUser` users `FORCE_CHANGE_PASSWORD`, answers `AdminGetUser` with the user's status (`CONFIRMED` when
none is given) and makes `AdminSetUserPassword` with `Permanent: true` set `CONFIRMED`. These run once, in
`desktop-1280`. Nothing runs on pepla-dev, and nothing reaches AWS, Postmark or any AI service.

`support/onb-04.2/lambda-harness.ts` re-exports ONB-04's harness and only points `runModule` (and the route
helpers built on it) at this fake. `support/onb-04.2/iam.create-employee.9b22758.tf.txt` is createEmployee's role
and policy as on the ONB-04 branch (PR #331, 9b22758): AC-5 checks createEmployee gains exactly `AdminGetUser` and
`AdminListGroupsForUser` on the pool against it.

Redeem's success answer stays ONB-04's 204 with no body (ONB-04 AC-2). The card text says 200.

Expected red before the build: AC-3, AC-4 and AC-5. AC-1 and AC-2 pass on #331 already.

## Locked tests of other cards changed under this lock

- `onb-04.spec.ts`: it imports `support/onb-04.2/lambda-harness` instead of `support/onb-04/lambda-harness`
  (same harness, the fake knows one more Cognito call); AC-7's last step now expects a new link for a sign-in
  whose password is already set to be refused with `InviteRefused` (the used link stays used and is not marked
  replaced); AC-11 lets `redeemInvite` and `createEmployee` also hold `cognito-idp:AdminGetUser` and
  `cognito-idp:AdminListGroupsForUser` on the pool. Nothing else in ONB-04's files changed, and
  `support/onb-04/` is untouched. `cards/onb-04.md` belongs to ONB-04's own locks, so this note lives here.
- ONB-03's files change under ONB-03's own re-lock `onb-03.5` (see `cards/onb-03.md`).
