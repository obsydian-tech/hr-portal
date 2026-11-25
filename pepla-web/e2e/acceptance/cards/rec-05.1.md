# REC-05.1

Card: REC-05.1 Older locked tests follow REC-05's offer changes (child lock of REC-05, NH-239)

Test files: `support/rec-05.1/grants.ts` (new) and marked lines ("child lock rec-05.1") in `rec-01.spec.ts` (AC-3),
`support/rec-01/routes.ts` (the two old offer writes), `mod-01.spec.ts` (AC-2, AC-8), `ten-03.spec.ts` (Control, AC-10),
`rec-02.spec.ts` (AC-11), `rec-04.spec.ts` (AC-8), `rec-07.spec.ts` (AC-9), `rec-15.spec.ts` (AC-17), `rec-15b.spec.ts` (AC-17)
and `chat-15.spec.ts` (AC-12).

Spec: `onboarding-cards/specs/REC-05.md` rules 1, 9, 11, 12 and 17. Locks: acceptance-lock/rec-05.1, on top of acceptance-lock/rec-05.

## What changes, and why

- Rule 17: `POST` and `PUT /v1/candidates/{id}/offer` answer 410 `{ error: 'OLD_ROUTE' }` after their existing role, company,
  module and row checks. rec-01 (Control and AC-2 through `routes.ts`), mod-01 AC-2 (founding company A) and ten-03 Control
  now expect that answer from a caller who passes the checks. The refusals those tests check (403, 404, module off) are unchanged.
- Rules 1 and 9: the old read `getOffer` shows OFFER_CREATED as DRAFT and holds no salary value for anyone. rec-01 AC-3 now
  expects state DRAFT for the manager and the Recruiter, and no salary value for the Recruiter (it used to expect baseSalary).
- Rules 11 and 12: one new Lambda, manageOffers, with its own role (`aws_iam_role.manage_offers`), and one new line for
  monitorTalentFlowSLAs (GetItem on the tenants table, to skip companies with Recruitment off when offers expire). The IAM
  checks of mod-01 AC-8, rec-02 AC-11, rec-04 AC-8, rec-07 AC-9, rec-15 AC-17, rec-15b AC-17 and ten-03 AC-10 allow exactly
  these through `isRec05Grant` / `isRec05Role` and nothing broader; rec-05 AC-10 judges the new role line by line.
- chat-15 AC-12 leaves out manageOffers' own Terraform resources (`manage_offers` or `manage_offers_<x>` in talent-flow-infra),
  as it does for REC-02, REC-04 and REC-14. So the builder names them that way.

No assertion is removed. On develop these fail on purpose until REC-05 is built: rec-01 Control, AC-2 (Recruiter-only) and
AC-3, mod-01 AC-2, ten-03 Control. Every other changed test passes on develop.
