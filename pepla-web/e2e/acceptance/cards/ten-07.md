# TEN-07

Card: TEN-07 Config check gets its own role, then the old all-access role goes (NH-199, epic NH-192)

Test files: `ten-07.spec.ts` and `support/ten-07/`

Spec: [NH-199](https://obsydian.atlassian.net/browse/NH-199)

Locks: acceptance-lock/ten-07

Part A only (AC-1 to AC-3). `ten-07.spec.ts` checks an infra card, so it opens no browser and runs once (in
`desktop-1280`). AC-1 and AC-2 read `infra/` and `talent-flow-infra/` as text with `support/infra-harness.ts`
and ONB-15's policy reader (`support/onb-15/tf-policy.ts`); no Terraform and no AWS. AC-1 also compares the rest
of the Config set-up with copies of `infra/modules/config/main.tf` and `infra/config.tf` as they were on develop
at 9057160 (`support/ten-07/*.9057160.tf.txt`), so only the function's `role` line and the removed
`lambda_role_arn` argument may change there.

AC-3 runs the real `lambda/configRegionCheck/index.mjs` in a fresh Node process against
`support/ten-07/fake-aws`: BE-17's module hooks cut down to one fake, an AWS Config client that records each
command and answers `PutEvaluations`. Any other AWS client, any AI client and any outbound HTTP call fails the run.

AC-4 (prod evidence after the release) is recorded on the card, not tested here. AC-5 (the old role is gone) is
Part B's PR and comes as a new test commit with its own lock, `acceptance-lock/ten-07.1`.
