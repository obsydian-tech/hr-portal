# CHAT-09

Card: CHAT-09 Ask Batsi gets the person page's facts (red, backend only, Lambda level)

Test files: `chat-09.spec.ts` and `support/chat-09/` (`harness.ts`, `world.ts`, `fake-aws/run.mjs`, `fake-aws/fetch.mjs`, `fake-aws/probe.mjs`).
Child locks that go with it: `acceptance-lock/onb-11.5` (ONB-11's getEmployee key list) and `acceptance-lock/chat-05.2` (CHAT-05 AC-4's document keys
and AC-7's instruction lines).

Spec: `/mnt/project-files/ask-batsi-chat/CHAT-09-person-page-facts.md` (19 Nov 2026, after the independent Opus check), question sheet
`CHAT-10-question-check-list.md` (its "auto" rows are AC-16 here), decisions in `DECISIONS.md`. Review page: `CHAT-09-tests-for-review.md`.

Lock: `acceptance-lock/chat-09` (free on 19 Nov; check `git ls-remote` at push time). One squashed test commit. The child locks are built on
`acceptance-lock/onb-11.4` (`bb6c2ea`) and `acceptance-lock/chat-05.1` (`acbdad1`, CHAT-06's) and are pushed with this one.

## How the tests run

All of `chat-09.spec.ts` runs once (`desktop-1280`) in the no-backend run and is skipped on pepla-dev. Nothing opens the app. Each Lambda call runs in a
fresh Node process (a cold Lambda) against CHAT-05's fake AWS, used as it is, with this folder's `run.mjs` (CHAT-05's, plus a fixed clock: today is
Thursday 19 Nov 2026, 10:00 in South Africa, unless a test sets another time) and `fetch.mjs` (CHAT-05's, plus a rule that fails as a network failure).

- For one person, the fake Agent API answers what the real `getEmployee` and `getDocumentVerifications` Lambdas answer on the same tables (they are run
  first, on the same rows). So the route change (AC-1, CHAT-05's two added keys) and the facts built from it are tested together.
- For the people list, the fake Agent API answers in `getEmployees`' item shape (private fields included), paged by `lastKey`.
- The model is scripted (CHAT-02's `bedrock-scripted.mjs`): the script says which lookup the model calls and with what input; the tests read what the
  lookup gave the model (the `tool_result` blocks of the last answer call). A call with no script is refused. Nothing reaches Bedrock or any AI host.
- AC-6 and AC-16 compare with HR home's own functions (`orderNewEmployees`, `isOverdue`, `countBySteps`, `toNewEmployee` from
  `src/app/core/employees/employee.ts`) on the same people and today, so Batsi and HR home cannot drift apart.
- AC-15 calls `resolveToolCall` directly through `probe.mjs`, a tiny handler that imports the chat Lambda's `tool-resolver.mjs`.

## What each test pins

| AC | Pins | Red on develop + CHAT-02 + CHAT-05? |
|---|---|---|
| 1 | `getEmployee` answers exactly 16 keys; `step` from `stepOf` (stage ACTIVE, no step: DOCUMENTS); `documents_due` = start minus 7; empty start gives empty start and due; `job_title`, `hr_staff_name`, `risk_assessed_at`; no phone, ID digits, HR partner email, encrypted value, company id or private key name; another company: 404 and nothing about the person | red |
| 2 | Pieter (stage ACTIVE, start 10 Nov 2026, no documents): exactly the facts keys; the values listed in the spec; `because` exactly the two Missing items; no "ACTIVE", "created", "stage" or "tenant" in the content; two Agent API calls in order (person, then documents); `structuredData.employee` is the raw answer; `toolCallsMade` as before | red |
| 3 | Ready only at Verified with a start date; the four cases of the spec with exact `because` lists; the newest upload of a type wins in either row order (HR refused the older ID, the new one waits); In review past its due date is not overdue; a stage with no step gives step null; the full document rows (required first, then a non-required upload; written upload and decision dates; HR's decision words); each row has exactly the six row keys; every word is the page's or CHAT-05's | red |
| 4 | Documents call 500, and no answer: facts still come with `documents: null`, `documents_unknown: true`, `because` "Documents could not be read", never "Missing", and the lookup is not an error. A Verified person with a start date stays ready with no reason | red |
| 5 | 450 people over three pages: three calls, `lastKey` from the page before, `total_matching` 450; 2,100 people: 10 calls, `complete: false`, 2,000 counted; every list URL holds only `limit=200` and `lastKey` | red |
| 6 | 12 people around today: HR home's order; `step`, `department` (case and outer spaces), `starts_from`/`starts_to` (inclusive, no date left out), `no_start_date`, `overdue` each keep exactly HR home's people; `sort` added and name; `counts_by_step` and `overdue_count` over every page and every person kept, not only those shown; exact list and person keys; `today` written; "Operations Support" is not kept by "Operations" | red |
| 7 | `hr_partner_is_me` by `custom:staff_id`, `cognito:username` and `sub`; `added_by_me` by staff id; planted `created_by`, `staff_id`, `hr_staff_id`, `tenant_id`, `company` from the model change nothing and reach no URL | red |
| 8 | Limit 40 asked: at most 20; long names: content at most 7,500 characters, never `TRUNCATED`, `shown` = people given and fewer than 20; ordinary names: 20; the people shown are the first ones of HR home's order (dropped from the end) | red |
| 9 | Six failures (risk check with nothing to check, risk check and lookup of another company's person, 401 every time, 503, no answer): the model gets exactly `{ outcome, say }` with the fixed sentence (a 404 whose text is not ours is NOT_FOUND too); no URL, path, host, "Agent API", status number or status line; `toolCallsMade` says `isError: true` | red |
| 10 | `<today>` in every turn, written with the weekday, South African date at 23:30 UTC the day before and 21:59/22:00 UTC; no number run; `<employee_in_focus>` as before. At 23:30 UTC on 18 Nov the facts (`days_until_start` -9) and the list (order, overdue, count) use 19 Nov | red |
| 11 | The two old lines are gone; the nine new lines are there once each, byte for byte; the other two limit lines, the impersonation line, the check-rows line and the first line are kept; no line says "first name only". It does not pin every other line, so CHAT-08's formatting lines (chat-05.3) need no change here | red |
| 12 | No secret value (phone, ID last digits, full ID number, HR partner email, encrypted blob) or private key name in the person content, the list content or `structuredData.employees`; every string except `start`, `due` and `employee_id` passes `hasNumberRun` false | red |
| 13 | A get_employee and a list_employees question make the same number of model calls and the same writes as a query_audit_log question (a lookup this card does not change), so there is no new model call or AWS write; and the unchanged lookup itself is pinned to develop's shape (3 model calls; `PutItem naleko-agent-audit`, one `TransactWriteItems` on `ask-batsi-chats`, `UpdateItem NalekoAiRateLimit`) | green; must stay green |
| 14 | Company B's HR person: 403, no lookup, no model call. Person, list (with every "me" filter) and risk lookups carry the server key only, no header naming a company or person, and no company id, staff id, sign-in id, `created_by`, "tenant" or "staff" in a URL | red (the old list URL carries `created_by`) |
| 15 | `resolveToolCall('get_employee')` answers the raw route answer with exactly one call and still throws on a failure (ONB-22 AC-5); `structuredData.employee` is raw (CHAT-05 AC-3) | green; must stay green |
| 16 | CHAT-10's auto rows: 1 to 11 and 13 to 23 (row 4 both ways; row 11 both ways; row 14 this and next week), each checking the facts in the sheet's last column; row 11 for all five risk results | red |

## Notes for the builder and the checker

- `getEmployee` must give all 16 keys every time: use `''` or `null`, never `undefined` (JSON drops undefined keys, and onb-11.5 compares the key list).
- `because` is a top-level key of the facts, next to `ready_to_start`.
- In a document row, `hr_decision` is empty (`''`) when the check is Missing, and "Not decided" otherwise when HR has not decided.
- `risk.reason` is empty when there is no band. AC-16 row 11 pins `{ result, reason, assessed_written }` exactly for a person with a stored check.
- "Me" in the list needs the asker's `cognito:username` and `sub` from the sign-in in the resolver context; the model's input never names anyone.
- `ask()` in `support/chat-09/world.ts` adds a `cognito:username` claim (`user-a1`) to company A's HR person, as Cognito does, so AC-7 can tell username from sub.
- AC-13 compares with `query_audit_log` in the same build instead of with develop, so it stays meaningful after CHAT-08 changes the prompt.
- AC-15's "every other locked spec that loads these Lambdas stays green" is checked by running those specs (chat-01, chat-01.1, chat-02, chat-05 with
  chat-05.1/05.2, onb-11 with its child locks, onb-22 with its child locks, ten-02, ten-04), not by this file.
- **ONB-22 and the ONB-11 key list (found by the independent check).** ONB-22's build (PR 422) also adds `step` to getEmployee, which breaks the
  same frozen ONB-11 line (`onb-11.spec.ts`, getEmployee's key list). So ONB-22 needs its own ONB-11 key-list child lock (10 to 11 keys). Both change
  the same line, so they stack: if ONB-22 merges first (the agreed order), its lock takes the next free name on `onb-11.4`, and this card's key-list
  commit is rebuilt on top of it (11 to 16 keys) under the next number. If ONB-22 waits until after CHAT-09, `onb-11.5` is pushed as it is and ONB-22
  needs no ONB-11 lock. Check names with `git ls-remote` at push time.
- Planted mistakes: `/mnt/project-files/ask-batsi-chat/chat-09-planted-faults.py` plants 32 mistakes and the checker's `chat-09-lock-check-faults.py` 16 more in the trial build, one at a time; each must turn its
  test red.
