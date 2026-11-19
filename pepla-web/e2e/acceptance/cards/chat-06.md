# CHAT-06

Card: CHAT-06 Proposal cards: Batsi suggests registering a new employee, and only the person who asked approves, edits or declines (red)

Test files: `chat-06.spec.ts` and `support/chat-06/` (`harness.ts`, `chat-fake.ts`, `fake-aws/`). New files only: no locked file is changed by this lock.
Three older locked tests pin today's behaviour that this card changes on purpose; they move in their own child locks (end of this file).

Spec: `/mnt/project-files/ask-batsi-chat/CHAT-06-proposal-cards.md` (19 Nov 2026) and `/mnt/project-files/ask-batsi-chat/DECISIONS.md`.
Review page: `/mnt/project-files/ask-batsi-chat/CHAT-06-tests-for-review.md`.

Lock: `acceptance-lock/chat-06` (free on 19 Nov 2026; check `git ls-remote` at push time). One squashed test commit on top of develop `3f23586`
with `acceptance-lock/chat-05` (which holds CHAT-02's lock and `onb-22.1`) and `acceptance-lock/onb-22.2` merged in, as the spec's order asks.
A commit that changes this file needs a lock named for the card: this is it. Build branch: `feat/chat-06-proposal-cards`, after ONB-22 (PR 422),
CHAT-02 (PR 421), CHAT-05 and CHAT-04 are merged. Nothing is pushed.

## How the tests run

The Lambda and text tests run once (`desktop-1280`) in the no-backend run and are skipped on pepla-dev. They run the real Lambdas
(`nalekoAiChat`, `approveAgentAction`, `askBatsiChats`) in a fresh Node process each, against a fake AWS (`support/chat-06/fake-aws`, copied
from CHAT-02's and CHAT-05's with code added only):

- approving invokes the **real** `createEmployee` in the same process and the same fake tables, with the fake Cognito, Step Functions and
  Postmark, so the employee row, the invite, the onboarding flow start and the welcome email are the register page's own;
- the fake invoke can lose the answer after a real run (`throw-after-run`), never settle (`throw-after-run-always`), time out (`throw`), fail
  (`function-error`) or answer a status (`status400`, `status403`, `status404`); the error words it throws hold a made-up secret and an account number,
  and the tests check that no answer, row, event or log line carries them;
- EventBridge delivers each event to the real `auditLogConsumer`, so the audit rows are the real consumer's;
- the model answers only from the test's script and records every prompt. Bedrock, Textract and every AI host are refused. Nothing calls a paid AI service.

The screen tests (AC-12, AC-13) run at 1280 and 390 with a fake Agent API in the browser (`chat-fake.ts`, its own copy of CHAT-01's, which is locked).

## What each test pins

| AC | Pins | Red on develop? |
|---|---|---|
| 1 | A scripted `onboard_new_employee` turn writes exactly one `CREATE_EMPLOYEE` row (PutItem with `attribute_not_exists(actionId)`): `toolName`, `PENDING_APPROVAL`, `BATSI` / `nalekoAiChat`, `requested_by` = the asker's staff id (the sub when there is none, as the chat does), `requested_by_name`, company A, `employee_name`, `chat_id` = the answer's `chatId`, the six details, ISO `createdAt`, `expiresAt` 7 days in epoch seconds. The answer's `message` is C6-1, one proposal with the same title, `canApprove: true`, `draft` = the quote (email, department, job title, one per line, no phone), `fields` = the six. CHAT-02 stores C6-1 as Batsi's message with the id in `proposal_ids`. No employee, invite, email, flow, invoke, event, sign-in, and one model call. A turn without the tool writes nothing. A failed row write: no card, no row, no stored id, P09 on a 2xx, no error words | red |
| 2 | Cleaning: only the six keys, company from the sign-in, department cut to 100, no number run in title, quote or message; an email never typed and a phone not in this question are empty (and the quote leaves the email line out); an email typed in an earlier question of the same chat is kept; a phone typed only earlier is not | red |
| 3 | Approve and decline by the second HR person of A, `hr_staff_readonly`, an employee, the agent key, an access token and an HR token with no email: 403, nothing invoked, written, published or emailed, the employees table not read, the row unchanged; the second HR person gets `{ "error": "Only HR can answer a proposal" }`; HR of B gets 404; a body naming the asker changes nothing; the asker's body naming someone else is 400 or ignored. HR's list shows a Batsi row to the asker only, keeps ONB-22's item keys, holds no draft email or phone; the agent key's GET of a Batsi row is 404 and of its own row 200 | red |
| 4 | The asker approves: one invoke of the function named in the setting, `RequestResponse`, with the approver's own claims, `Idempotency-Key` = the action id, a body of the six details only; one employee in A with the drafted details, `created_by` the approver; `employee.invited`, an invite, the flow start and one welcome email to the new person; the answer's `result` `{ employee_id, name, email, email_sent }`, `approved_by_name`, `approved_at`; the row `APPROVED`, `RAN`, `created_employee_id`, no phone; `proposal.approved` names Batsi, the approver, `requested_by`, `proposed_at`, the employee and company. A second approve is 409 and runs nothing; two at once run once; a test address gets no email and `email_sent: false` | red |
| 5 | A missing phone: 400 `{ error: 'Check the highlighted fields', fields: { phone: 'This is required' } }`, the row untouched, nothing invoked, published or claimed; a wrong email in `changes` is 400 with its field; `changes` with a key outside the six, a body key other than `changes`, or `changes` that is not an object is 400 with nothing claimed. `changes` filling the phone registers; the row and event say `approved_with_changes`, the event `changed_fields: ['phone']` and never the value | red |
| 6 | Same email in A: `REFUSED` `ALREADY_EXISTS`, no second employee, no email, the row says so; same email in B only: `RAN`; answer lost after a real run: one repeat with the same key, `RAN`, one employee, one email; never settles, times out, function error: one repeat and no more, `FAILED` `RUN_UNKNOWN` on the answer and the row; status 400/403/404: `REFUSED` `DETAILS_REFUSED` / `NOT_ALLOWED` / `NOT_FOUND`, no repeat; no error words anywhere | red |
| 7 | Decline with a reason holding a phone and an ID number: `REJECTED`, by whom, when, the reason kept with both numbers removed, phone out of the draft, `proposal.rejected` with the masked reason and `requested_by`, nothing run; a long reason is at most 500; no reason is fine; a declined or expired proposal cannot be approved (409, nothing written); the model never receives a reason (asked on in the same chat) | red |
| 8 | The chat's code (comments left out) holds no approve or decline route, `approveAgentAction`, `createEmployee`, Lambda client, `InvokeCommand` or `CREATE_EMPLOYEE_FUNCTION_NAME`; the chat role has no `lambda:` right; "yes", "approve it" and "Yes, approve it and register him now" change no row and run nothing; Accept document is still answered by any HR person and its decline still ignores the reason | red (the "yes" turns need a row to exist) |
| 9 | With an ID number, a bank number and the phone planted in the draft, the changes and the reason: both `proposal.*` events and their audit rows have no number run and no draft email or phone; the chat's own audit row of the proposing turn has no number run; title, quote and message neither | red |
| 10 | HR of B (chat serving B through `AGENT_TENANT_ID` until CHAT-04): the row is B's for HR of B; HR of A does not see it and gets 404 on approve and decline with nothing run and B's row unchanged; HR of B approves and the employee is in B though the draft named A; HR of B on A's row: 404, nothing run | red |
| 11 | `GET /v1/chats/{id}` after four proposals made by the real chat: waiting, approved (name, time, employee), declined (name, masked reason), expired (`canApprove: false`); `fields` only on the waiting one; a planted `canApprove: false` on the row is ignored; another person's, another company's and a deleted proposal id are left out, every question still shows; another person opening the chat gets 404 | red |
| 12 | The screen: Batsi's question as its own message above the card; "Suggested by Batsi", the title, the quote without the phone, "Waiting for you", Approve, Edit, Decline. Approve: "Approved", "Approved by {server's name}.", a `<time>`, "View employee" to `/hr/employees/{id}`, no audit link, then "{name} has been added." and the email line (or the not-sent line); an empty body. Edit: a drawer named by the title with the six labelled fields filled; Back sends nothing; Approve sends `{ changes }` with the six only and shows "Approved with changes by …". A 400 with `fields` opens the drawer with the message under the field and the card still waiting. Decline: the help line without "Batsi uses this to suggest better next time.", then "Declined", "Declined by {server's name}.", the time, the reason, "Batsi did nothing.", body `{ reason }`. `REFUSED` on a 200: "Did not go through" and the failed line, never "Approved by" or a link. `FAILED RUN_UNKNOWN`: C6-3 and never the failed line. A 409: the failed line | red |
| 13 | 390 wide: the buttons read Approve, Edit, Decline and sit inside the screen; the drawer's six fields and Approve and Back are visible, inside the screen, not under the top bar; no sideways scroll; the phone field takes typing | red |
| 14 | `createEmployee`, `reviewDocumentVerification`, `talentFlowApproveAction` and `createProposal` are not edited (hashes); `TOOL_MAP` has the same eight tools and `onboard_new_employee` still only drafts; `approveAgentAction` imports `validateEmployee` from `../shared/employee-input.mjs`, does not copy it and imports no AI client; none of the three Lambdas imports another Lambda's folder; `check-ai-guard.py` passes; the other specs it names are in the folder | green on develop for most rows (red: `validateEmployee` import) |
| Terraform | `approveAgentAction` has `CREATE_EMPLOYEE_FUNCTION_NAME` naming `create_employee`, may invoke `create_employee` (and only it and the review, `lambda:InvokeFunction` only); `askBatsiChats` has exactly `GetItem` on `pending_actions`; its role is in `dynamodb_read_role_arns`; `infra/ai_guardrail.tf` is unchanged (hash) | red |

## Choices the spec left open, pinned here

1. Decision 2 says `role: admin` in the draft: the tool's `role` is the job title, so AC-2 plants other keys (`tenant_id`, `tenantId`, `company`, `isAdmin`, `groups`) and checks none is kept. Today's `onboard_new_employee` already maps the draft to the six keys, so this guards a future tool change.
2. AC-9 is pinned on the `proposal.*` events, their audit rows, and the chat's audit row for numbers. `employee.invited` is `createEmployee`'s own unchanged event (it carries the email by ONB-04's design). The chat's audit row also holds the draft email inside `tool_outputs_raw` (CHAT-02's record of tool calls); this lock does not pin that away. Flagged for the checker.
3. Company B's chat runs with `AGENT_TENANT_ID` set to B until CHAT-04 lands. When CHAT-04 changes how the chat picks the company, the AC-10 setup line may need a child lock.
4. Front end item 9 (a reopened chat on the screen) is not tested on the screen: the past-chats screen is not built. AC-11 pins the server half.
5. The approve answer may carry `approved_with_changes`; the screen shows "Approved with changes by" when it sent a change, whatever the server says.
6. A body naming another approver on the asker's own approve: 400, or 200 with the token's person as approver. Both are accepted.
7. A failed row write: a non-2xx answer is accepted; a 2xx must say P09. Either way, no card and no row.
8. Times, epoch numbers and UUIDs are taken out before the number check (`withoutTimes`): a random UUID can start with six digits.

## Older locked tests this card changes (child locks, separate commits)

| Lock | File | Test | Why it must move |
|---|---|---|---|
| `chat-05.1` | `chat-05.spec.ts` | AC-6, the register-employee lines | CHAT-05 pinned today's register path: the old fixed text as `message`, no `proposals` key, no row in `naleko-pending-actions`. CHAT-06 changes exactly that. The child lock keeps CHAT-05's other AC-6 checks and drops those three lines |
| `chat-02.1` | `chat-02.spec.ts` | AC-31 (Terraform) | CHAT-02 pinned `askBatsiChats` to logs, X-Ray, its own table, the audit table and the company row. CHAT-06 lets it read a proposal by key to draw a reopened chat's cards (spec, Terraform item 4). The child lock allows exactly `GetItem` on the pending table |
| `onb-22.3` | `onb-22.spec.ts` | AC-8 (IAM) | ONB-22 pinned `lambda:InvokeFunction` to the review function only. CHAT-06 adds `createEmployee` to that statement list (spec, Terraform item 4). The child lock allows exactly the two |

All three were found by running the locked specs against the throwaway build (see the review page). `onb-22.3` shares `onb-22.spec.ts` with CHAT-02's own ONB-22 child lock (CORS, table count, key-policy list): whichever is pushed second is rebuilt on top of the first and takes the next number. Names checked free with `git ls-remote`.
