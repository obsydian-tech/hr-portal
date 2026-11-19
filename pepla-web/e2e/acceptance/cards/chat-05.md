# CHAT-05

Card: CHAT-05 Ask Batsi answers carry the check rows the screen expects (red, backend only, Lambda level)

Test files: `chat-05.spec.ts` and `support/chat-05/` (`harness.ts`, `world.ts`, `fake-aws/`, `baseline/*.json`), plus one moved test of another card (end of this file).

Spec: `/mnt/project-files/ask-batsi-chat/CHAT-05-answer-shape.md` (18 Nov 2026, after the independent Opus check; the proposal half is
CHAT-06) and `/mnt/project-files/ask-batsi-chat/DECISIONS.md`. Review page: `/mnt/project-files/ask-batsi-chat/CHAT-05-tests-for-review.md`.

Lock: `acceptance-lock/chat-05` (the name is free; check `git ls-remote` at push time). One squashed test commit on top of develop `c00bf96`
with `acceptance-lock/chat-01.1` (`1775dca`, CHAT-02) and `acceptance-lock/onb-22.1` (`69ed58b`, ONB-22) merged in, as the spec's order asks.
A commit that changes this file needs a lock named for the card: this is it. Build branch: `feat/chat-05-answer-shape`, rebased on CHAT-02's merged handler.
Nothing is pushed. Written against develop `c00bf96`.

## How the tests run

All of `chat-05.spec.ts` runs once (`desktop-1280`) in the no-backend run and is skipped on pepla-dev. Nothing opens the app. The tests run the
real Lambdas (`lambda/nalekoAiChat` and `lambda/getDocumentVerifications`) in a fresh Node process each, against a fake AWS and a fake Agent API
(`support/chat-05/fake-aws`, copied from CHAT-02's with code added only):

- the Agent API is a fake (`fetch.mjs`, from ONB-22's): the test writes the answers by URL text, every call is recorded, a call with a wrong key is 401,
  an AI host fails the call, and a run with no script refuses every outside call;
- the model is scripted by the test (`bedrock-scripted.mjs`, from CHAT-02's): a call with no script is refused and recorded, so nothing reaches Bedrock;
- a DynamoDB Query on an index now pages (it gives a `LastEvaluatedKey` naming the table key and the index key, as DynamoDB does), so a route that reads one
  page of a company's `tenant-index` misses rows here exactly as it would in AWS. The Scan path (the founding company) paged already. Both fakes page four rows at a time.

AC-10 reads both Terraform stacks as text (there is no Terraform here; the PR's required Terraform check runs the real plan).

## What each test pins

| AC | Pins | Red on develop? |
|---|---|---|
| 1 | One person's lookup answers `structuredData.checks`: the required rows first (ID document, Bank letter, from `requiredFor`), then Matric certificate and Tertiary qualifications if the person has them; screen words from the spec's word table (Q-6, ONB-15); Missing only when no read document of the type; a document being read is Being checked, not Missing; the newest upload of a type wins (by `arrived_at`, then `document_id`), whatever order the list comes in; the model's `list_verifications` tool offers `employee_id` and passes it to the Agent API; the old `structuredData.verifications` and the status and tool-call fields are as before; no `proposals` key | red |
| 2 | The route's check is `checkOf`'s: a stored check wins over confidence, no stored check uses the 90 rule (90 is Matches, 85 Needs a look), no verification yet is Being checked or Needs a look; a verification of another company is not a document's. A check outside the four known values never shows Matches (the build shows Needs a look) and its raw text is never shown. The rows hold no digit at all: confidence 97, a 13-digit ID and odd values (a check or a type with a number in it) planted in the tool answer reach no row or result, and the shared `hasNumberRun` is false on every label and result | red |
| 3 | No `checks` key (not an empty one) for a list of several people, a call without `employee_id`, a failed call, a question with no verification call, another tool; a type the word table does not know gives no row and its raw code is never shown | red |
| 4 | Route, `employee_id` branch: a person whose rows sit after the first page is answered in full on both read paths (company `tenant-index`, founding company's Scan), for the agent and an HR caller; `documents` holds one item per read document with exactly four keys (`document_id`, `document_type`, `check`, `arrived_at`), no confidence, no file key or name, an upload link with no file (`PENDING`) is not in it; `items` and `count` are as today and now complete; every DynamoDB call is one the route's role may make (Query on the two `tenant-index`es, Query and Scan on the base tables), nothing is written; `agent-plain`, `hr-plain`, `hr-limit-2`, `hr-waiting` and `agent-plain-legacy` answers are byte for byte the golden files taken from develop `c00bf96` on the same rows; company B is answered its own row for that id and never company A's | red |
| 5 | Company: company B's agent and HR caller, asking for company A's person, get no items, no documents and nothing of A's; naming company A (or B) in the query, headers, path and body changes nothing; the chat Lambda still answers a company-B caller 403 with `{ "error": "Forbidden" }`, builds nothing, calls neither the Agent API nor the model | green on develop; must stay green |
| 6 | Tool names, not tool output, drive the shape: a planted `checks` or `proposals` in another tool's answer, in a one-person answer, or in the model's own text is data; the answer never has a `proposals` key; the register-employee path is as it is today (`pendingAction`, `hitlDraft`, `PENDING_APPROVAL`, the fixed text) and writes no row to `naleko-pending-actions` | red |
| 7 | The system prompt (read from the model call's `system`): first line `You are Batsi, an HR onboarding assistant for South African companies.`, no `Naleko AI`, the three limit lines byte for byte as on develop, every other old line kept, exactly one line added and it says the screen shows each check as a row so answer in one short sentence | red |
| 8 | `AI_CALLS_ENABLED=false`, a robot login, the 51st question in an hour and a cached SIMPLE answer behave as today: no `checks`, `proposals` or `documents` anywhere, the fields they have today, no model call (the cached one: no answer call), no Agent API call, no row | green on develop; must stay green |
| 9 | A failure on the `employee_id` branch (both read paths, agent and HR) answers 500 `{ "error": "Something went wrong" }`, no error text in the answer or the logs, only the error's name logged (be-18's rule for the new branch) | green on develop; must stay green |
| 10 | Terraform: `getDocumentVerifications`' role policy is exactly what it is on develop (no new index, no new action), no `aws_dynamodb_table_item`. Imports: `getDocumentVerifications/index.mjs` and every `.mjs` in `lambda/nalekoAiChat/` import only `node:` modules, files that exist in their own folder or `lambda/shared`, and the packages they have today | green on develop; must stay green (it fails if the build widens the role or adds an import) |

The spec lists AC-1 to AC-4, AC-6, AC-7 and AC-10 as red before merge. Here AC-5, AC-8, AC-9 and AC-10 pass on develop (they guard what must not change);
AC-1 to AC-4, AC-6 and AC-7 fail on develop. Run on develop `c00bf96` with the locks merged.

## AC-9 of the spec (the locked specs that load these files still pass)

This is a rule for the throwaway and the builder, not a test: `ten-02` (handler run), `ten-04` (the AI guard import), `onb-22` (resolver run, waiting list),
`chat-02` (lock `chat-01.1`) and `be-18` (the route) are run untouched on the throwaway with CHAT-02's build in. Results are on the review page.

## Pinned by the verifier beyond the text (for the BA to confirm)

1. **`documents[]` has exactly four keys** and `check` is one of `MATCHES`, `NEEDS_A_LOOK`, `DOESNT_MATCH`, `READING`: the spec gives that shape and "no confidence, no file link".
2. **Two lookups for the same person**: not pinned (the spec says "exactly one person"; the test only uses one call per person).
3. **A check value that is not one of the four** in the Agent API's answer: the row must still be there and must never show "Matches" (it shows one of the screen's other results, no digit, never the raw value). A build that drops the row fails. Which of the other results it shows is not pinned (the throwaway shows Needs a look).
4. **Which tool call feeds the rows** when a person is looked up twice: not pinned.
5. **The new prompt line**: only that it is one new line and says row, check and sentence (the spec gives the sense, not the words). It is a line the model reads, not screen text.
6. **CHAT-04 will move AC-5's last paragraph** (the chat Lambda's 403 for company B): CHAT-04 needs a child lock of `chat-05` for that one assertion.
7. **The route's role** is pinned as it is today (AC-10), so any Terraform change for this card fails here; if the builder finds the role must change, that is a new card.
8. **The cache**: the SIMPLE cache key changes with the prompt (the new name and line). That is expected: the first question after deploy is a miss.

## Where these tests are worded differently from the spec

- **AC-9 and AC-10 of the tests are not the spec's AC-9 and AC-10.** The spec's AC-9 (the locked specs that load these files still pass) is a rule for the throwaway and the builder, so it has no test (section above). The tests' AC-9 is the spec's failure rule for the `employee_id` branch (500, fixed body, error name only), and the tests' AC-10 is the spec's Terraform and import rule.
- **The spec's "fail on develop" list is wrong about AC-10.** The spec lists AC-10 as red before merge. It passes on develop, because it guards what must not change (the role policy and the imports). It fails only if the build widens the role or adds an import. AC-5, AC-8 and AC-9 also pass on develop for the same reason. AC-1 to AC-4, AC-6 and AC-7 are the red ones.
- **One locked test moves:** `onb-13.spec.ts` AC-11, under child lock `onb-13.2` (see the last section).

## Moved test (the spec said none would move)

`onb-13.spec.ts`, AC-11: it compared HR's answer to the frozen old Lambda for six queries, one of them `?employee_id=EMP-1301`. That branch is what CHAT-05 changes
(every page, and a `documents` key), so the query is taken out of that list (one line, with a comment). The branch is pinned by `chat-05.spec.ts` AC-4 instead.
Suggested lock: `acceptance-lock/onb-13.2` (`onb-13` and `onb-13.1` exist; check at push time). It shares the one squashed commit.
Found by running the locked specs on the throwaway: with CHAT-02's build and the throwaway in, this was the only locked test that went from passing to failing.
