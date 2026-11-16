# OPS-05

Card: OPS-05 Terraform applies itself, prod on Approve (child of NH-150): checks the Terraform and workflow files

Test files: `ops-05.spec.ts`, `support/ops-05/`

Spec: `onboarding-cards/specs/OPS-05.md`

Locks: acceptance-lock/ops-05, acceptance-lock/ops-05.2, acceptance-lock/ops-05.3, acceptance-lock/ops-05.4, acceptance-lock/ops-05.5, acceptance-lock/ops-05.6, acceptance-lock/ops-05.7

## Re-lock ops-05.7 (ONB-24, 16 Nov 2026)

ONB-24 adds one DynamoDB table, `reset_test_sink` (dev only: `count = 0` in prod, so the block still counts; deletion
protection on, `prevent_destroy = true`), so AC-7's table count goes from 26 to 27. Nothing else in this card's tests changed.

## Re-lock ops-05.6 (ONB-05, 16 Nov 2026)

ONB-05 adds one DynamoDB table, `employee_consents` (deletion protection on, `prevent_destroy = true`), so AC-7's
table count goes from 25 to 26. Nothing else in this card's tests changed.

## Re-lock ops-05.5 (ONB-04, 16 Nov 2026)

ONB-04 adds one DynamoDB table, `employee_invites` (deletion protection on, `prevent_destroy = true`), so AC-7's
table count goes from 24 to 25. Nothing else in this card's tests changed.
