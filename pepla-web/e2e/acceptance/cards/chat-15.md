# CHAT-15

Card: CHAT-15 An hourly job deletes a deactivated person's Ask Batsi chats (red, backend only)

Test files: `chat-15.spec.ts` and `support/chat-15/` (`lambda-harness.ts`, `world.ts`, `terraform.ts`, `fake-aws/`,
`baseline/ai_guardrail.ccc2beb-419.tf.txt`, `baseline/kms-lists.ccc2beb-419.json`, `baseline/terraform.ccc2beb-419.json`,
`baseline/alarm-lambda-names.ccc2beb-419.json`).

Spec: `/mnt/project-files/ask-batsi-chat/CHAT-15-delete-leavers-chats.md` (19 Nov 2026). Review page:
`/mnt/project-files/ask-batsi-chat/CHAT-15-tests-for-review.md`.

Locks (names are the lock-check thread's to confirm and push; next free on the remote at 20 Nov 06:50 UTC): `acceptance-lock/chat-15`
for `chat-15.spec.ts` and `support/chat-15/`. Four earlier locks read the PII key's read list or the role policies of the TalentFlow
stack and fail once the new job exists, so each has a small child lock in the same push, one commit each: `onb-22.8` (AC-8 expected
exactly four roles in `dynamodb_read_role_arns`; now also allows the job's role ARN), `ten-02.10` (AC-13 pattern for that list),
`mod-01.15` (AC-8 "new role policy belongs to a gated Lambda") and `ten-03.15` (AC-10, same). The two role-policy ones skip a policy
or role whose name contains `leaver_chats` or `deleteLeaverChats`, so the builder's Terraform label must contain `leaver_chats`
(for example `delete_leaver_chats`). The ONB-22 wait is over (#422 merged as 7ac6233).

Written against develop ccc2beb plus PR 419 (the saved lists are labelled ccc2beb-419). Nothing is pushed.

## How the tests run

All of `chat-15.spec.ts` runs once (`desktop-1280`) in the no-backend run and is skipped on pepla-dev. Nothing opens the app.
The Lambda tests run the real handler (`lambda/deleteLeaverChats/index.mjs`) in a fresh Node process each, against a fake AWS
(`support/chat-15/fake-aws`, copied from CHAT-02's with code added only): BatchWriteItem can be made to get stuck or to
pretend it deleted, Cognito can fail for one person, and the Lambda context reports the time left that the test sets. AC-12 and
AC-13 read both Terraform stacks as text (nothing here runs Terraform; the PR's Terraform check does). No test calls AWS or any
AI service.

## What each test pins

| AC | Pins |
|---|---|
| 1 | A leaver's chats are deleted under both keys (staff id and sign-in id), the person is marked, one audit row is written |
| 2 | Company walk: the leaver in company A and the leaver in company B (run both ways) with a twin of the other company sharing the staff id, plus look-alike partitions `STF10` and `STF1X`: only the leaver's own company rows are read or deleted, exact writes and Query keys |
| 3 | 30 and 64 minutes: nothing; 66 minutes: done; the wait counts from `deactivatedAt`, never `updatedAt` |
| 4 | Only real leavers: active, still-enabled sign-in, already marked, no deactivation time are left alone |
| 5 | Never half-done, safe to repeat: stuck or silently kept deletes, failing audit write or mark; nothing marked, no record; the next run finishes; a third run writes nothing |
| 6 | One person's failure (stuck delete or Cognito) does not stop the others; the run still ends in error |
| 7 | Company from the stored row only; no `tenant_id` means the founding company; none set means skipped |
| 8 | Cognito has no such person: the row's `userId` alone is the key and the record says so |
| 9 | The audit row holds exactly the 11 listed fields, no title, message, name or email; a leaver with no chats still gets one (`rows_deleted` 0) |
| 10 | Logs hold counts and error names only, whatever AWS call fails |
| 11 | 250 waiting leavers: 200 a run, the rest the next; a skipped person (sign-in still enabled, company unknown) uses none of the 200 places (BA decision, 19 Nov); with under 30 seconds left no new person starts, with 30 seconds one does |
| 12 | Role policy lines exact (no wildcard but X-Ray); function settings; hourly rule, state from a variable, one target, one permission; the role is in the key's read list once and not the encrypt list; add only (no removed or renamed resource, no table data, `adminDeactivateUser` byte for byte); any failure is a Lambda error and the function is on the error alarm |
| 13 | No AI: no model client imported (transitively), only the people, chats and audit tables and Cognito used; the guardrail file is byte for byte develop's |
| 14 | A missing required setting stops the job at the start, "Missing setting NAME", before any AWS call; an empty `LEGACY_TENANT_ID` is valid |
| 15 | The event decides nothing: an event naming another company, person or key changes nothing; an empty event works |

## Pins the verifier made (for the BA to confirm or change before the lock)

- P-1 `handler(event, context)`; the event is ignored.
- P-2 Time left comes from `context.getRemainingTimeInMillis()`; exactly 30,000 ms still starts a person, under it stops; running low is not an error.
- P-3 The 200 cap counts people started. Decided 19 Nov: a skipped person (still enabled, company unknown) uses no place; pinned by an AC-11 test.
- P-4 The wait is 65 minutes counted from `deactivatedAt`.
- P-5 Cognito is asked by the row's email.
- P-6 Keys are staff id and sign-in id (the row's `userId` when Cognito has no user).
- P-7 Order: Cognito, company, delete, verify, audit PutItem, UpdateItem; the mark changes only `chats_deleted_at`.
- P-8 Audit fields (11): `pk, sk, action LEAVER_CHATS_DELETED, tenant_id, user_id, staff_keys (list of the words "staff_id" and "sub"), staff_id_unknown, deactivated_at, deactivated_by, rows_deleted, expiresAt` (epoch seconds, +90 days); no `date` attribute.
- P-9 The alarm is `"deleteLeaverChats"` in the `lambda_names` of `infra/alarms.tf` only.
- P-10 Any failure ends in a thrown error with the job's own words; logs carry error names only.
- P-11 Terraform names: function `deleteLeaverChats`, role `talent-flow-role-deleteLeaverChats` (path `/talent-flow/`), rule `delete-leaver-chats`, all in `talent-flow-infra`; an optional `ENVIRONMENT` setting is allowed.
- P-12 The rule state comes from a bool variable, default false, true in `env/dev.tfvars`.
- P-13 `USERS_TABLE_NAME`, `COGNITO_POOL_ID`, `CHATS_TABLE`, `AGENT_AUDIT_TABLE` are required; `LEGACY_TENANT_ID` may be empty or absent.
- P-14 The baselines are frozen at develop ccc2beb plus PR 419 (label ccc2beb-419) (Terraform resource list, moved and removed blocks, `adminDeactivateUser` hashes, key lists, alarm list, guardrail file).

## Expected state

On develop: 23 of 23 red (no job, no Terraform). On a throwaway correct build: 23 of 23 green. The build is not part of the lock; see
`/mnt/project-files/ask-batsi-chat/chat-15-throwaway-build-NOT-FOR-MERGE.patch`.
