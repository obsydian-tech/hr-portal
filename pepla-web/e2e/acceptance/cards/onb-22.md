# ONB-22 acceptance notes (The same rules through the Agent API and MCP, NH-183)

Files: `onb-22.spec.ts` (35 tests, AC-1 to AC-10) and `support/onb-22/` (fake AWS harness, develop baseline `baseline-c859f0f.json`, dev seed contract `dev-ids.json`). New files only, no child locks, no locked file changed.

## Pinned choices (also in the spec header)
- P1 A run that is refused or fails still answers 200 to the approve call, with `run_status` and a code only.
- P9 Approve and decline are on the HR sign-in (JWT) and use the token's company (`x-tenant: token`).
- P10 The summarise and MCP rights are second policy resources, because ten-02 pins their existing policies byte for byte.
- P2 to P8 as in the spec header (expiry in epoch seconds, ISO createdAt, seed contract, and so on).

## Lock
Push `acceptance-lock/onb-22` and `acceptance-lock/ten-04.4` (378c8cb); onb-22.1 locks: `onb-22.1`, `mod-01.6`, `ten-03.6`, `be-17.4` (one commit), after the independent check.

## Locked specs that stay green with a correct build
ten-02, be-17.1, be-18, be-19, be-20, ops-05, onb-20 AC-8.
ten-04 AC-7 goes red: its rows list approve and decline as `covered`, which wants an agent-key caller, and ONB-22 moves those two routes to the HR sign-in. Fix, IN this commit (coordinator's call, 18 Nov): two-row child lock of `support/ten-04/rows.ts`. Push it as `acceptance-lock/ten-04.4` (or the next free name) AFTER ten-04.3 (PII-01), since both edit ten-04 files; merge the lock commit, do not hand-copy.

## Child lock onb-22.1 (security review, 18 Nov)
One test commit on top of 378c8cb (`onb-22`, `ten-04.4`). It changes `onb-22.spec.ts` and the harness (`eventBridgeFailFirst`, `eventBridgeDown` by type prefix, callers `hrNoEmail` and `hrBlankEmail`), and three locked specs that a correct ONB-22 build turns red (found by running them on the throwaway build):
- `mod-01.spec.ts` AC-8 and `ten-03.spec.ts` AC-10: every new role policy must belong to a gated Lambda or the pre-token trigger. ONB-22 adds a new role (`create_proposal`) and second policies (`approve_agent_action_onb22`, `summarise_verification_employees`, `naleko_mcp_server_agent_key`); both specs skip exactly those four keys (`onb-22.spec.ts` AC-8 pins their contents). Lock names `mod-01.6`, `ten-03.6`.
- `be-17.spec.ts` AC-6: `summariseVerification` may join `dynamodb_read_role_arns` (it reads the employee). Lock name `be-17.4`.
Test changes: M-1 old key refused 5 minutes after a rotation (warm container); M-2 no idempotency table, and a guard test reads the DynamoDB calls `createProposal` really makes and checks its policy covers each (own rows and founding company); M-3 `RUNNING` on the claim, decided rows kept 90 days (and the `RetentionDays` tag), events published with one retry, a bus-down test; S-1 HR token with no email is 403; S-2 the employee read holds `first_name`, `last_name`, `tenant_id`.
Cross-card checks against develop `ade6d09` (PII-01, #414): `get_verification_summary`'s manifest entry must stay exactly as on develop (PII-01 AC-11 pins it), and `summariseVerification` fails closed only when the employee row is there (no email, another company's row, a test address); no row at all is left to the other guards, because PII-01's locked rows have none (pinned by one added case in onb-22 AC-6).

## Child lock onb-22.2 (ONB-14, 19 Nov)
One test commit on top of 69ed58b (`onb-22.1`). It changes only AC-10 in `onb-22.spec.ts`. ONB-14 (NH-182, its AC-4 and security review C-1) must stop `GET /v1/verifications/{id}` returning `id_number` and `account_number`, which edits `lambda/getSingleDocumentVerification/index.mjs`. AC-10 now takes that file as either develop c859f0f's hash or exactly ONB-14's (PR 429 at 4ec4147, sha256 `c3b9ffb0...ac72`). The other four hashes are unchanged and the baseline file is not touched. A later edit of that file needs another child lock.

## Owed
- Step 0 (prove the code findings on dev with AWS reads): a Mac thread.
- AC-7 (pepla-dev) runs only after the seed change and a dev deploy.
- onb-15 and onb-20 browser specs were not run here (no app server).

## Known gaps (follow-ups)
- Two defences guard an expired proposal (early check and the claim); the tests fail only when both are gone.
- Two proposals made at the same moment for one document are not guarded.
- Wrong-key calls read the secret once each (no throttle).

## Child lock onb-22.3 (CHAT-02 and ONB-21 on the same develop as ONB-22)
Only `onb-22.spec.ts` AC-8 changes, in three lines, so that ONB-22 and CHAT-02 (and ONB-21) can merge in either order:
- The agent API's CORS may also allow `DELETE` (Delete chat). Every other part of the block (headers, origins, max age) is still compared with the baseline, and no method but `DELETE` may be added.
- The table count is the baseline (17) plus `ask_batsi_chats` and `reminders` when those two tables exist. Any other new table still fails.
- `dynamodb_read_role_arns` may also hold `ask_batsi_chats`, `admin_set_ask_batsi` (CHAT-02) and `send_document_reminders` (ONB-21), besides the four roles of this card. Any other role still fails.

## Child lock onb-22.6 (first dev run of AC-7, 19 Nov)
Only the one line of `onb-22.spec.ts` AC-7 (pepla-dev) that checks the agent key cannot approve its own proposal changes. It expected 403. On pepla-dev the approve and decline routes use the HR sign-in check at the API gateway (`infra/agent_api.tf`, authorization_type JWT), so an agent key with no sign-in is turned away there with 401, before any code runs. The line now accepts 401 or 403. Any other answer (200, 404, 500) still fails, and the next lines still need HR's own call to approve (200) and the action to run once. Nothing else changes. Locks: acceptance-lock/onb-22.6.

## Child lock onb-22.7 (ONB-11 AC-11 on dev)
Only `onb-22.spec.ts` AC-8 changes, in one list and its message: `dynamodb_read_role_arns` may also hold `sfn_onboarding`, the onboarding state machine's role, besides the four roles of this card and the three of CHAT-02 and ONB-21. The state machine stores a task token on the employees row, and without this entry the invite fails with AccessDenied on the PII key. Any other role still fails.
