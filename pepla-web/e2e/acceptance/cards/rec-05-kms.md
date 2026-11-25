# REC-05 key follow-up (rec-05-kms)

Card: REC-05 follow-up, NH-239. manageOffers and the hourly offer expiry can use the PII key.
Tests: `rec-05-kms.spec.ts`, `support/rec-05-kms/kms-lists.8283605.json` (the key's two role lists and the two role names on
develop 8283605). Lock: acceptance-lock/rec-05-kms. Child lock it needs: acceptance-lock/ten-02.12 (older tests make room).
Review this comes from: onboarding-cards/specs/REC-05-build-security-review-507.md, findings 1 and 3, "KMS follow-up".

## What the builder changes

1. `infra/kms.tf`, module `kms_pii`, by quoted ARN with a comment, as the other TalentFlow roles there:
   - `allowed_role_arns` gains `"arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-manageOffers"`.
   - `dynamodb_read_role_arns` gains that ARN and `".../talent-flow/talent-flow-role-monitorTalentFlowSLAs"`.
   Trailing comma on each line, as in the file (onb-22 AC-8 compares the list as squashed text).
2. `scripts/ci/seed-dev.py` `seed_rec05`: one `ddb.delete_item(TableName=STATE_TABLE, Key={"PK": {"S": f"TENANT#{tenant_id}#OFFER_LIVE#{ids['candidate']}"}, "SK": {"S": "LOCK"}})` each run.
3. Nothing in talent-flow-infra: both roles exist on develop already, so the key can name them (CHAT-15 apply-order lesson).

## Criteria

- AC-1 manageOffers on `allowed_role_arns` once; monitorTalentFlowSLAs not on it.
- AC-2 both on `dynamodb_read_role_arns` once each, no other spelling.
- AC-3 each ARN is the role its Lambda runs as (name and /talent-flow/ path resolved from talent-flow-infra), and both roles
  were already on develop 8283605 (apply order).
- AC-4 nothing else on either list moves, and the key's third list (`cognito_sender_decrypt_role_arns`, direct Decrypt) stays
  exactly `[aws_iam_role.cognito_email_sender.arn]`.
- AC-5 the dev seed deletes the seeded candidate's live-offer lock row each run (finding 3), by its whole key:
  PK `f"TENANT#{tenant_id}#OFFER_LIVE#{ids['candidate']}"`, SK `LOCK`, in STATE_TABLE.

On develop 8283605: AC-1, AC-2, AC-5 fail; AC-3, AC-4 pass (guards).

## Not in these tests: the dev test REC-05 AC-11 (waits for Iggie)

After the key change, rec-05.spec.ts AC-11 on pepla-dev still cannot pass, for reasons outside the key:
- It needs an approver test login, `E2E_APPROVER_EMAIL` / `E2E_APPROVER_PASSWORD`. No such login is in the seed personas and
  no such setting is passed by `.github/workflows/app-e2e-dev.yml`. A login in company A with the approver tick
  (`perm-approve-offers`) and a GitHub secret pair would be needed.
- It expects company B to get 404 and an empty list. In the main dev step `E2E_HR_B` is company B, which has only Onboarding,
  so Recruitment routes answer 403 there. REC-02 AC-12, REC-03 AC-11 and REC-04 AC-10 are run in the "Company walk" step,
  where `E2E_HR_B` points at hr-c; REC-05 AC-11 would need the same (grep-invert in the main step, grep in the walk step).
Both are workflow and dev-login changes. They wait for Iggie unless they only add things on dev and an independent check of a
saved plan passes first (rule 7b). Nothing here changes them.
