# TEN-02.12

Card: TEN-02.12 Older locked tests make room for the REC-05 key follow-up (child lock, NH-239)

Test files: `support/ten-02.12/kms.ts` (new) and marked lines ("child lock ten-02.12") in `ten-02.spec.ts` (AC-13 Roles hold
exactly this), `be-18.spec.ts` (AC-1 recordConsent uses the PII key only through DynamoDB), `onb-22.spec.ts` (AC-8 IAM) and
`chat-15.spec.ts` (AC-12 The role is added once to the PII key's read list).

Why: REC-05 (PR 507) added manageOffers. The tenants table and the uploads bucket are encrypted with the PII key, and neither
manageOffers nor monitorTalentFlowSLAs is on the key's lists, so on pepla-dev every /v1/offers route answers 403 and the hourly
offer expiry skips every offer. The follow-up adds, in `infra/kms.tf` module `kms_pii`, by quoted ARN (both roles live in
talent-flow-infra, and both exist on develop 8283605 already):

- manageOffers on `allowed_role_arns` (signed uploads into the bucket need encrypt and data-key rights) and on
  `dynamodb_read_role_arns` (the Recruitment check on the tenants table);
- monitorTalentFlowSLAs on `dynamodb_read_role_arns` only.

## What changes in the older tests, and nothing more

- ten-02 AC-13: the read list's allowed quoted ARNs gain the two names. The rest of the pattern is unchanged.
- be-18 AC-1: "allowed_role_arns gains no role" leaves out the manageOffers ARN only (written exactly).
- onb-22 AC-8: "allowed_role_arns gains nothing" takes out one copy of the manageOffers ARN before comparing, so a second copy or
  any other new entry still fails; the read list's other-cards list gains the two ARNs.
- chat-15 AC-12: each of the two ARNs may be on the read list at most once; the manageOffers ARN may be on the encrypt list at most
  once; every other entry of both lists must still be as on develop.

No assertion is removed. Every changed test passes on develop 8283605 and on the follow-up. Exact placement (manageOffers on both
lists once, monitorTalentFlowSLAs on the read list once and not on the encrypt list) is pinned by `rec-05-kms.spec.ts`
(lock acceptance-lock/rec-05-kms), not here.
