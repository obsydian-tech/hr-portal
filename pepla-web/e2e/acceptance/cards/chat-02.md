# CHAT-02

Card: CHAT-02 Ask Batsi keeps each person's chats until they delete them, and each company switches Ask Batsi on (red, backend only)

Test files: `chat-02.spec.ts` and `support/chat-02/` (`lambda-harness.ts`, `world.ts`, `infra.ts`, `fake-aws/`,
`baseline/ai_guardrail.c859f0f.tf.txt`, `baseline/allow_headers.c859f0f.json`), plus the moved tests of other cards listed at the end.

Spec: `/mnt/project-files/ask-batsi-chat/CHAT-02-stored-chats.md` (18 Nov 2026). Review page:
`/mnt/project-files/ask-batsi-chat/CHAT-02-tests-for-review.md`.

Locks (names are the lock-check thread's to pick and push; suggested): `acceptance-lock/chat-01.1` for `chat-02.spec.ts` and
`support/chat-02/` (child of CHAT-01's lock, as the card says); `mod-01.N`, `ten-02.N`, `ten-03.N`, `be-18.N`, `be-17.N`
and `ops-05.N` for the one moved test each. These share the one squashed commit; check the real repo for the next free name of
each before pushing.

Written against develop c859f0f. Nothing is pushed.

## How the tests run

All of `chat-02.spec.ts` runs once (`desktop-1280`) in the no-backend run and is skipped on pepla-dev. Nothing opens the app.
The Lambda tests run the real handlers in a fresh Node process each, against a fake AWS (`support/chat-02/fake-aws`, copied from
MOD-01's with code added only): the model is scripted by the test (`bedrock-scripted.mjs`; a call with no script is refused and
recorded), DynamoDB Query now orders by sort key, pages by `world.pageSize` (4) and honours `ExclusiveStartKey`, and
BatchWriteItem over 25 requests is refused as DynamoDB does. AC-31 and AC-32 read both Terraform stacks as text. No test
calls AWS, Bedrock or any AI service.

## What each test pins (AC numbers continue CHAT-01's; AC-15, 16 and 19 to 24 are the card's, AC-25 to AC-32 pin the rest of its text)

| AC | Pins |
|---|---|
| 15 | Nobody reads, adds to or deletes another person's chat (same company, other company, same staff id in another company, forged owner in body, query and headers, malformed ids); 404 never 403; a made-up chat id is 404 and makes nothing |
| 16 | Delete chat removes the header and every message, writes an audit row (CHAT_DELETED, chat id, person, company, no content); second delete is 404; nothing is removed by age |
| 19 | No chats: 200 with an empty list |
| 20 | Delete all my chats: that person's only, more than 25 rows (batch limit), audit row CHATS_DELETED_ALL; none to delete is 2xx |
| 21 | Switch off or never set (founding row with no attribute, other companies): read, list and ask 403, nothing written, no model call; delete one and delete all still work and are audited (security review, finding 3); on: the routes work and `GET /v1/company/modules` shows `ask_batsi`; off keeps chats, on brings them back; `MODULE_KEYS` has the third key and the founding default does not turn it on |
| 22 | PUT /v1/admin/company/ask-batsi `{enabled}`: only `admin` of that company; 400 for a body that is not a boolean; other attributes kept; audit row in MOD-01's shape; a no-op writes no row |
| 23 | Stored question, answer and title hold no ID, phone or bank number, spaced, hyphenated, dotted or 12 digits (the AC-33 inputs); both chat Lambdas import the shared redactor |
| 24 | AI off or a test login: the stand-in answer, nothing stored, no model call; read and delete still work with AI off |
| 25 | Chat id in the answer; storage as the card says (keys, header, messages, company on every row); second question joins the same chat; the audit record names the chat; title at most 80 characters; tools and proposal ids kept |
| 26 | History is the server's: a forged `conversationHistory` in the body is never sent to the model or stored |
| 27 | List newest first by last use, 50 a page with `nextToken`; opening a chat gives every message in order, no internal keys |
| 28 | Only `hr_staff` / `naleko-talentflow-hr` with an ID token; company and person from the sign-in alone; no staff id is 401 |
| 29 | Logs hold only error names: no question, answer, raw model text, AWS message; no error text leaves a Lambda; a failed read is a 5xx, never an empty list |
| 30 | The 50-an-hour limit stays; a limited question stores nothing and calls no model |
| 31 | Terraform: the table (keys, on demand, PII key, point-in-time recovery, deletion protection on, no expiry, no index, no rows, 29 tables), the two Lambdas and their settings, the routes on the agent API with JWT, CORS allows the methods, no new `allow_headers`, minimal roles, PII key access |
| 32 | `infra/ai_guardrail.tf` is byte for byte develop's; the old chat code keeps `guardAi`, the robot and off check and the sanitiser; the new Lambdas call no model |
| 33 | The audit record is masked too (see Follow-on) |
| 34 | Answer cache only for a chat's first question, key holds the company (security review finding 1); AC-31 also pins deletion protection and that no client writes `custom:staff_id` |

## Decisions the verifier made (for the BA and Iggie to confirm or change before the lock)

- D-1 Five chat routes on the agent API (the API of `POST /agent/v1/ai-chat`), one Lambda `askBatsiChats` that picks the route by its routeKey.
- D-2 A question goes to the existing chat route with `chatId` in the body; the answer carries `chatId`. A foreign, unknown or malformed `chatId` is 404 (400 or 404 for a malformed one) and no chat is made under a client's id.
- D-3 The switch is modules key `ask_batsi` through MOD-01's `requireModule`; the founding "no attribute = every module" rule does not turn it on.
- D-4 The admin route is `PUT /v1/admin/company/ask-batsi` `{ "enabled": boolean }`, Lambda `adminSetAskBatsi`, answer 200 `{enabled}`, needs `admin`, writes MOD-01's audit row shape (`MODULES#<iso>#<id>`, from, to, by = caller sub, tenant_id), no row for a no-op, never an empty string set.
- D-5 Table `ask-batsi-chats`; the Lambdas read its name from `CHATS_TABLE`, the company list from `TENANTS_TABLE`, the audit table from `AGENT_AUDIT_TABLE` (askBatsiChats).
- D-6 The person is `custom:staff_id`, else the sub; the partition key is `T#<tenant>#S#<staff>`.
- D-7 Header fields `chat_id, title, created, updated, message_count, tenant_id, staff_id`; message fields `role (person|batsi), text, at, tenant_id, tools, proposal_ids`; message key `MSG#<id>#0001`.
- D-8 The API shape is camelCase: list `{chats:[{chatId,title,updated}], nextToken?}`, get `{chatId,title,created,updated,messages:[{role,text,at,tools,proposalIds}]}`.
- D-9 The title is the sanitised first question, at most 80 characters.
- D-10 Order is by `updated`, newest first, sorted in memory, 50 a page.
- D-11 DELETE answers 200 or 204; a second delete is 404; delete-all with none is 2xx.
- D-12 A delete writes an audit row to the audit table: `action` CHAT_DELETED or CHATS_DELETED_ALL, `conversation_id` = chat id, `staffId`, `tenant_id`, no content.
- D-13 The audit record of a question carries the chat id as `conversation_id`.
- D-14 AI off and robot callers get the stand-in answer, store nothing, call no model; read and delete still work with AI off.
- D-15 A refused, rate-limited or unknown-chat question stores nothing.
- D-16 The chat routes need `hr_staff` or `naleko-talentflow-hr` and an ID token; a missing or invalid company is 403.
- D-17 The switch check on a question comes after the robot and AI-off answers (they touch nothing, as BE-17 pins), before the rate limit.
- D-18 A failed read or write of a chat is a 5xx with no error text, never an empty list or a half-stored chat.
- D-19 No new request header on any API (LESSONS NH-187); the agent API gains `DELETE` and `PUT` in `allow_methods`.
- D-20 Role policies are minimal: this table (and the audit table for delete), the company list for the switch, logs, X-Ray; no `*`, no Scan, no AI.
- D-21 `ai_guardrail.tf` does not change.
- D-22 Both stacks hold 30 tables after this card on top of ONB-21 (29 without it; the order in TONIGHT-PLAN is ONB-21, CHAT-02, REC-04, so `ops-05.N` takes the number current when it is pushed).
- D-23 Existing `err.message` and `stack` logging and the `detail: err.message` answer in both chat Lambdas, their intent classifiers and the TalentFlow tool resolver become error names only.
- D-24 The company fix for `nalekoAiChat` (it serves `AGENT_TENANT_ID` only) is not specified by the card; the tests accept 403 or 404 for another company on a question (open question O-1 on the review page).

## Open questions (BA / Iggie)

- O-1 The company fix for `nalekoAiChat` is not specified. The tests only pin that another company's person cannot add to a chat and nothing is written.
- O-2 The existing audit `promptSummary` stores raw question text, which can hold an ID, phone or bank number. This card's chats are sanitised; the audit row is not. POPIA question for Iggie.
- O-3 `set-modules.mjs --on ask_batsi` has no seed; whether the dev seed gives the test companies the switch is the builder's.
- O-4 Founding company after release: with the founding rule unchanged, Ask Batsi is off until an admin turns it on. A release step, not a test.

## Moved tests of other cards (re-locked in the same commit)

A correct build turns these red; each moved only by what the card adds.

- `ops-05.spec.ts` AC-7: 28 tables becomes 29.
- `mod-01.spec.ts` AC-1: `MODULE_KEYS` is `onboarding, recruitment, ask_batsi`. AC-7: `lambda/adminSetAskBatsi/index.mjs` is allowed to write the `modules` attribute. AC-8: the two chat Lambdas' roles gain only the chats table and a GetItem on the company list; the two new roles are judged in `chat-02.spec.ts` AC-31.
- `ten-02.spec.ts` AC-13 (both tests): `naleko_ai_chat` and the two new roles are judged in AC-31; `allowed_role_arns` gains the two new roles.
- `ten-03.spec.ts` AC-10, `be-17.spec.ts` AC-6 (through `support/ten-02/relock.ts`, `chat02Grant`) and `be-18.spec.ts` AC-1.

Not moved, by design: the switch check sits after the robot and AI-off answers, so the BE-17, BE-17.1, BE-18, MOD-01 and TEN-02 robot tests stay as locked.
`ten-04.spec.ts` stays green only when the builder adds the five routes to `api/openapi.yaml` and a walk row for each to
`scripts/tenancy/ten-04-rows.json`; that is the builder's work, not a moved test.

## Follow-on (AC-33)

Iggie, 18 Nov: the audit record is masked too, with the shared PII-01 redactor. AC-33 pins it for both chat Lambdas (no six-digit run in `promptSummary`, `responseSummary`, tool outputs; both import `../shared/pii-redact.mjs`). It needs PII-01's file to exist, so it is green only after PII-01 merges or the builder brings the file in. Lock name `chat-01.2` or in the same lock if not yet pushed.

## Security review, 18 Nov (CHANGES) and what the tests now pin

Review: `/mnt/project-files/ask-batsi-chat/CHAT-02-security-review.md`. Added to the same lock (squashed):

- AC-34 (new) answer cache. `naleko-prompt-cache` and `talent-flow-prompt-cache` were keyed on the words alone. Now the cache is read and written only for the first question of a chat (no `chatId`), and the key holds the company. Tests: a colleague, a person of company B and a later question in a chat never get another chat's cached answer, and the model is called.
- AC-23 uses the AC-33 inputs and both chat Lambdas must import `../shared/pii-redact.mjs` for what they store. PII-01 must merge before CHAT-02 is built.
- AC-21 (new test) the two delete routes still work with the switch off (decision 3, recommended by the review; Iggie may still change it). Read, list and ask stay 403.
- AC-31 pins `deletion_protection_enabled = true` on the table, and that no Cognito client lists `custom:staff_id` in `write_attributes`.
- Existing: the founding company's default set is written out before `ask_batsi` is added (mod-01/chat-02 AC-22).

### Builder rules with no test, or only a cheap one (the review's items 5 to 14)

- B-1 Deleted chats stay in backups: point-in-time recovery keeps deleted rows up to 35 days. Say that honestly in the POPIA notice (Iggie's wording P27 and P36 to P39); do not claim the data is gone from every copy.
- B-2 Delete all retries `UnprocessedItems` until empty and answers 5xx if rows are left; it never reports success with rows left.
- B-3 A question racing a delete: append the message with `attribute_not_exists(sk)` on the message key and update the header with `attribute_exists(pk)`, so nothing recreates a headerless chat and two tabs asking at once cannot overwrite a message (the tests use TransactWriteItems, which the fake already accepts).
- B-4 Keep the founding default written out before `ask_batsi` is added (see above).
- B-5 Keep the `AGENT_TENANT_ID` refusal in `nalekoAiChat`; do not pass the company to the Agent API under this card. An admin of company B can switch Ask Batsi on and still be refused. The Admin screen must not promise otherwise (wording for Iggie).
- B-6 Owner key: `custom:staff_id`, else `sub`; AC-31 pins that no client can write it.
- B-7 No tracing of chat text: no Powertools `captureResponse` or `captureLambdaHandler` on `askBatsiChats`, and no question or answer in X-Ray annotations or metadata. Only the tracer is created, as in the old Lambdas.
- B-8 Rate-limit and audit keys are not company-scoped (`rateLimit#<staffId>`, `demo#<staffId>`). Add the company to the new keys this card writes; a later card for the old ones.
- B-9 The audit row keeps the masked first 200 characters of each question after Delete all my chats. Acceptable once masked; say so in the POPIA notice.
- B-10 Stored answers are replayed to the model in the same person's later turns. Same-person only and writes still need Approve; keep the 50-an-hour cap and the approval step.
- O-5 (for Iggie, tap) deleting with the switch off: the tests pin that it works.
