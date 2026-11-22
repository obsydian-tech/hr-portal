# CHAT-08

Card: CHAT-08 Batsi's answers read as text, lists, tables and charts (red: it changes what the chat Lambda sends and the AI instructions)

Test files: `chat-08.spec.ts` and `support/chat-08/` (`harness.ts`, `world.ts`, `chat-fake.ts`, `fake-aws/register.mjs`, `fake-aws/hooks.mjs`,
`fake-aws/bedrock-turns.mjs`). Child lock that goes with it: `acceptance-lock/chat-05.3` (CHAT-05 AC-7's instruction lines), built on
`acceptance-lock/chat-05.2` (`bf00ed0`).

Spec: `/mnt/project-files/ask-batsi-chat/CHAT-08-answer-formats.md` (19 Nov 2026, after the independent spec check, `CHAT-08-spec-check.md`),
decisions in `DECISIONS.md` ("CHAT-08 spec" rows and the 15:25 rows). Review page: `CHAT-08-tests-for-review.md`.

Lock: `acceptance-lock/chat-08` (check `git ls-remote` at push time). One squashed test commit, on top of `acceptance-lock/chat-09` (`bfc3c81`)
with `acceptance-lock/chat-05.2` and `acceptance-lock/chat-06` merged in (CHAT-08 reads the lookups CHAT-09 builds and the stored chats CHAT-02
and CHAT-06 change).

## How the tests run

The Lambda tests (AC-1 to AC-12, AC-21, AC-22) run once (`desktop-1280`) in the no-backend run and are skipped on pepla-dev. Each Lambda call runs
in a fresh Node process against CHAT-05's fake AWS, with CHAT-09's `run.mjs` (fixed clock: Thursday 19 Nov 2026, 10:00 in South Africa) and
CHAT-09's fake Agent API (`agentApi`, `listRules`, `personRules`, `tablesWith` from `support/chat-09/world.ts`, used as they are). This card's
only addition to the fake AWS is `fake-aws/bedrock-turns.mjs`: CHAT-02's scripted model, plus one message that holds a sentence and tool calls at
once (needed for AC-21). Nothing reaches Bedrock, AWS or any outside host.

- The tables are compared with the list CHAT-09 gave the model in that same turn (read from the `tool_result` blocks of the last model call),
  so the order and the words are CHAT-09's, and this card is only tested on drawing them.
- AC-12 runs the real `askBatsiChats` Lambda (`GET /v1/chats/{id}`) on the tables the chat Lambda wrote.
- The screen tests (AC-14 to AC-19) run the app at 1280 and 390 against `support/chat-08/chat-fake.ts`, which answers `blocks` (and `checks`).
  They skip on pepla-dev.

## What each test pins

| AC | Pins | Red on today's code (CHAT-09 lock + CHAT-02, CHAT-05, CHAT-06, CHAT-09 builds)? |
|---|---|---|
| 1 | `show_records people`: one table, headers Employee, Step, Start date, HR partner; one row per person in the lookup's order; "Not set", "Not assigned"; "7 Sep 2026"; `personId` from the record (a UUID); no ISO date, no URL | red |
| 2 | The model's own pipe table with wrong dates is dropped when a records view is built; the record's date shows; no `\|` left in the words; the sentence is kept | red |
| 3 | Nine bad `show_records` inputs: each a tool error to the model with a short fixed reason (no stack), and the answer's records are exactly those of the same turn without the call; `show_records` is offered with `view` (the six views, required) and `limit` only; no secret value, `@`, or private key name in any block (list and person views) | red |
| 4 | Default view: a list of 3 gives the people table; one `get_employee` gives the facts (exact items, card order and words) and the checks block (ID document, Bank letter: Missing); empty fields left out; documents call failing gives facts and no checks, never "Missing"; list plus one person gives the person view only; a failed list gives no records; `show_records` with no lookup gives nothing; two different people and no `show_records` give no records; with `show_records person` the last person looked up is drawn; two `show_records` calls: the last wins; one person plus CHAT-05's per-person rows: the rows are not repeated in blocks; the `documents` view: Employee, Document, Check in CHAT-05's words (check from the stored check or the score, never the raw decision), unknown types left out, `personId` only for a UUID | red |
| 5 | Step chart from `counts_by_step` in STEPS order, title "People by step", no table as well; no chart when the list is not complete; department chart: 8 bars, largest first, ties by name, "Other" with the rest and no department; no department chart when fewer people than match or one department; risk chart: approved words, high, medium, low, not assessed; no chart when all 0; bar values whole numbers 0 to 10,000 | red |
| 6 | Iggie's five screenshot answers: no `**`, `__`, backtick, heading mark or pipe-table line left in any block; no paragraph starts with a bullet; the listed words still read; "- a / - b" and "1. / 2." make one list each; with no records view, screenshot answers 2 and 5 keep the model's pipe table as a table block with its own headers | red |
| 7 | The table shows what the lookup shows, "Showing 20 of 40."; `limit 5` gives the first five and "Showing 5 of 40."; all shown: no `more`; cells at most 120 characters; at most 8 blocks, paragraphs 1,200, lists 20 items of 300 | red |
| 8 | No string in `blocks` (except `personId`) has a number run (`hasNumberRun` from `lambda/shared/pii-redact.mjs`), with dates and a planted ID number in the model's text and in a cell; "14 Sep 2026", never "Sept"; an `EMP-…` id gives no `personId`, a UUID is kept; a number run planted in a person's job title and department is removed from the facts | red |
| 9 | The bullet-list line is gone; the two format lines once each, byte for byte; every line the locks already pin (chat-05.2, chat-09) is still there ("nothing else added" is CHAT-05 AC-7's, chat-05.3); `infra/ai_guardrail.tf` equals CHAT-02's pinned copy | red |
| 10 | Step words in the table equal the Today page's (`STEPS` from `core/employees/employee.ts`); a step that is none of the four reads "Not set"; no raw step code anywhere; the risk fact reads the approved words for LOW, MEDIUM, HIGH (`RISK_WORD` from `core/employees/risk-words.ts`) | red |
| 11 | AI off, a robot, the 51st question (429), the company switch off (403) and a cached answer: no `blocks` key, no model answer call, no Agent API call | green; must stay green |
| 12 | A reopened chat gives back each answer's blocks exactly and CHAT-05's check rows; planted stored blocks are cleaned on the way out (unknown kind dropped, table cut to 25 rows, non-UUID id dropped, planted HTML not sent); another HR person: 404; another company: 404; an answer with over 20 KB of blocks (two long model tables) is stored with its text blocks only | red |
| 14 | Screen: a real table with the four column headers and 4 rows; the "Showing" line; every `td` carries its column word as `data-label`; at 390 no sideways scroll, rows stack (each cell takes the row's width, or the header row is hidden), no button off the right edge | red |
| 15 | Screen: a name with a UUID `personId` is a link to `/hr/employees/<id>` that opens it; an `EMP-…` id gives the name with no link | red |
| 16 | Screen: one `pp-bar-chart` with its title; each bar's words and number are written; each bar's words sit with its own number; a table (hidden is fine) holds the same numbers; nothing in the chart animates or transitions; at 390 no sideways scroll and the chart fits the screen | red |
| 17 | Screen: HTML in every part of an answer (text, list, facts, checks, table, chart) shows as characters; no `img`, `b`, `script` or `iframe` in the conversation; no dialog; no `innerHTML`, `outerHTML`, `bypassSecurityTrust` or `DomSanitizer` in `ds/agent`, `features/hr-assistant` or the bar chart's file (which must exist) | red |
| 18 | Screen: an answer with only a message loses its marks ("Status: ACTIVE") and its bullet lines are a two-item list | red |
| 19 | Screen: an unknown block kind is skipped and the blocks after it still show. A second test: each document row shows its label and its result word; a numbered list is an `ol` | red |
| 21 | A sentence and `show_records` in one model message ends the turn: 2 model calls (as the same listing without `show_records`), that sentence is the message, the table is drawn; `show_records` alone in a message: 3 calls, as today; `show_records` makes no Agent API call; a sentence with `show_records` and another lookup does not end the turn (3 calls, the last sentence is the answer) | red |
| 22 | After `list_employees`, `get_employee`, `list_verifications` and `assess_employee_risk` with planted phone, ID last four, HR partner email and ID number: none of them, and no private key name, anywhere in the answer | red |

Proven on 19 Nov, after the lock check: see `CHAT-08-tests-for-review.md` for the run counts, the writer's planted mistakes
(`chat-08-planted-faults.py`) and the checker's (`chat-08-lock-check-faults.py`).

## Where these tests differ from the spec's words (logged in DECISIONS.md)

- **AC-22** in the spec says `structuredData` no longer holds `employees`, `employee`, `verifications` or `riskAssessment`. The locked tests
  pin those raw answers (chat-05.spec.ts AC-1, AC-4, AC-5: `structuredData.verifications` and `.employee` are "still the Agent API's own
  answer"; chat-09.spec.ts AC-2 and AC-15: `structuredData.employee` is the raw answer). Removing them would need child locks on two locks
  that were pushed today for exactly that pin. So AC-22 tests what matters to Iggie: the whole answer holds none of the planted private values or
  key names. CHAT-09 already cleans `employees`; the build must strip the private keys from the other raw answers it still sends. Removing the raw
  fields is a follow-up for after both locks merge (a child lock each).
- **AC-7**: the spec's example is "Showing 25 of 40." CHAT-09's list gives the model at most 20 people, so the table shows the 20 the lookup
  shows and says "Showing 20 of 40." The test reads the number from the lookup, not from the spec.
- **AC-9** pins only this card's lines and that the earlier pinned lines are kept; "nothing else added" is left to CHAT-05 AC-7 (lock check's
  recommendation, logged 19 Nov 19:50), so a later prompt card needs one child lock, not two.
- **AC-13** (no new AWS write, no new model call on a lookup) is CHAT-09's AC-13, which stays green; this file adds AC-21 for the one case the
  card changes (sentence plus `show_records`).
- **AC-20** (the past-chats screen draws stored blocks) waits for the past-chats screen, which no card has built yet. AC-12 tests the stored
  blocks at the route.
- A refused `show_records` "draws nothing": tested as "the answer's records are the same as if it had not been called" (the default view still
  applies), which is how the spec's default-view rule reads.

## Notes for the builder and the checker

- `show_records` is answered in `index.mjs` before `resolveToolCall`; it is not in `tool-resolver.mjs`'s map (CHAT-09's). It is not added to
  `toolCallsMade` in the answer.
- Read records from `toolCallsMade[].result` (what the code got), not from the text the model was given: today's `sanitisePii` masks long
  digit runs in what the model reads, which includes the dev UUIDs (`00000000-…` reads as an account number to it).
- The limits must apply on the way out of a stored chat too (AC-12), so they belong in a module both `nalekoAiChat` and `askBatsiChats` load
  (`lambda/shared/`).
- On the screen, a Batsi message with `blocks` is drawn from them; one without is drawn through the same parser. The chat's table uses the
  design system's stacked table (`table[ppTable]` with `stack`); without `stack`, AC-14 fails at 390.
- Design system first (`pepla-design-system`): `pp-bar-chart` and the panel's block drawing, then copied into `pepla-web/src/app/ds`.
- Planted mistakes: `/mnt/project-files/ask-batsi-chat/chat-08-planted-faults.py` plants each mistake in the trial build one at a time; each must
  turn its test red.
