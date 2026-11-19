# CHAT-01

Card: CHAT-01 Ask Batsi chat: top bar button, side panel and full page (spec date 18 Nov 2026, tier red)

Test files: `chat-01.spec.ts` and `support/chat-01/chat-fake.ts`

Spec: `/mnt/project-files/ask-batsi-chat/CHAT-01-ask-batsi-chat.md` (AC-1 to AC-18), words in `words.json` (all approved).

Locks: acceptance-lock/chat-01

These tests add files only; no other card's file changed.

## What is in this lock, and what is not

In: AC-1, AC-2, AC-3 (who sees the button; the API 403 screen), AC-4 to AC-10, AC-12 (panel and full page), AC-13, AC-14, AC-17, AC-18.
Left to CHAT-02 (child lock `chat-01.1`): AC-11, AC-15, AC-16, the list of chats on a phone (AC-12), New chat, Delete chat and its confirm words, and the per-company switch (the "company has it off" half of AC-3). Nothing in this lock touches `/v1/chats` or the company flag.

## How the tests run

All run at 1280 and 390 wide with no backend (no-backend run only; none runs on pepla-dev, the card says real AI is judged there by a person). Cognito is the shared fake. The Agent API is answered in the browser by `support/chat-01/chat-fake.ts`; it answers any host that is not the app. The shared fixture `blockAi` still aborts every other `/agent/v1/` call, Bedrock and Textract. AC-17 records every request of a whole conversation and fails on any AI host.
AC-9 also runs the two real `pii-sanitiser.mjs` files (a pure function, no AWS).
Two AC-12 tests run at 390 only.

## The contract these tests fix where the card is silent (the builder implements exactly this; the BA confirms)

1. **Where it calls.** `environment.agentApiUrl` (new key, placeholder `https://agent-api.invalid`; real value written by CI) plus `/agent/v1/...`. Every call carries `Authorization: Bearer <ID token>`. No body, query or header carries the company.
2. **Asking.** `POST /agent/v1/ai-chat`, JSON body `{ message, screenContext: { view, employeeId } }` (`employeeId` only on a person's page). Answer 200 `{ message, structuredData, status, proposals? }`.
3. **Checks as rows.** `structuredData.checks = [{ label, result }]` (new; the Lambda builds it). The label and the result are drawn as separate pieces of text inside one row; never raw JSON, never a table.
4. **Proposals.** `proposals = [{ actionId, title, draft, canApprove, approver?: { name } }]` with `status: 'PENDING_APPROVAL'`. `canApprove: false` gives "Waiting for {approver.name} to approve." and "You asked for this. Only {approver.name} can approve it." and no Approve button.
5. **Approve and Decline.** `POST /agent/v1/actions/{actionId}/approve` and `/reject`, with the person's own sign-in. **These two routes are API-key routes today (`approveAgentAction`); the browser needs JWT versions on the same paths. That is backend work this card does not list.** Approved shows "Approved by {signed-in person's full name}.", a `<time>`, and the link "View in audit trail" (words from the design system proposal card) with an address.
6. **What waits.** `GET /agent/v1/actions/pending` (exists today, JWT, `{ actions, count }`). **It is read when Ask Batsi is first opened (and after each answer), never on page load**: a call on load fails the locked "calls only Cognito, GET /v1/employees ..." tests of ONB-02, ONB-12, ONB-13 and ONB-15 and puts console errors into MOD-02 (checked on the throwaway build, see the review page). The top bar button says "Ask Batsi, {count} waiting" (P26) when the count is above 0, else "Ask Batsi"; a failed read shows no count and no error. The count follows approvals and declines. Recommendation taken, logged: a count at page load needs a small later card that re-locks those four specs.
7. **Where.** The top bar button is in the HR shell (`.pp-top-navigation`), accessible name starts "Ask Batsi"; icon only below 768 wide, still with the name. The panel is `role=dialog` named "Batsi" with the log "Conversation with Batsi", composer "Message Batsi", Send, Stop, "Close Batsi" and "Open as a full page" (P22). Full page: `/hr/ask-batsi` (HR guard; signed out goes to sign-in, an employee is sent away), panel class `pp-agent-panel--page`, link "Back to Today" that returns to the page the person came from (HR home when opened directly). Panel and page share one conversation.
8. **Answers.** The page shows what the API answered: the words for 403 (P12 and P13), 429 with `retryAfter` seconds (P11, minutes rounded up), failures and a network error (P09 and "Try again", which asks the same question again), offline (P14, composer disabled). Stop ends it with P04 and a late answer is dropped.
9. **No second way in.** No element outside the top bar and panel opens Ask Batsi.

## Things the tests decided where the card is silent (for the BA to confirm)

1. The working line has no fixed words (the number is real data): the test only needs a status region starting "Batsi is" with a Stop button.
2. The panel's greeting uses the signed-in person's first name (P02); the three suggestions show for a new conversation (W05 only on a person's page). Clicking a suggestion is not tested.
3. Edit on a proposal is not tested (no outcome is specified). Decline is tested through the design system card (Decline, then "Decline proposal").
4. P36 to P39 (delete confirmation) and everything about stored chats are CHAT-02.
5. Count of waiting comes from the pending route (read when the panel is first opened), so it covers proposals made earlier, but a person who has not opened Ask Batsi in this visit sees no count.

## Shared locked files

None changed. New files only: `chat-01.spec.ts`, `support/chat-01/chat-fake.ts`, this note.
**Risk for the builder:** the HR shell now calls `GET /agent/v1/actions/pending`. Locked specs that count or forbid calls are listed in the review page with the result of running them on the throwaway build.

## Changed tests of other cards (found by running every HR-shell spec on the throwaway build; precedent MOD-02, ONB-10)

The top bar gains one button, so three locked files move. Each change is the one line the button needs and nothing else:
- `support/mod-02/baseline.json` (MOD-02 AC-5, AC-9): HR top bar gets `Ask Batsi` (icon hash of the `sparkles` icon) after `Open menu`.
- `ang-01.spec.ts` (ANG-01 AC-15): a pull request that changes only this spec or `support/ang-01/develop-bars.ts` is no longer judged as ANG-01's own (the trigger no longer fires on `ang-01.spec.ts` or `develop-bars.ts`; it fires on `cards/ang-01.md` or the other files in `support/ang-01/`). Without this, any CHAT-01 pull request fails AC-15.
- `support/ang-01/develop-bars.ts` (ANG-01 AC-15): `HR_BAR` gets `button:Ask Batsi:shown` after the search input (desktop) and before Search (phone).
- `onb-12.spec.ts` (ONB-12): the check "no Ask Batsi to assess risk button" matched `/Ask Batsi/i`; it now matches `/Ask Batsi to assess risk/i`.
Lock names for these (all free on the remote): `acceptance-lock/mod-02.3`, `acceptance-lock/ang-01.3`, `acceptance-lock/onb-12.4`, at the same commit as `acceptance-lock/chat-01`.
Run on the throwaway: every other HR spec (ONB-01 to ONB-09, ONB-12 to ONB-24, ANG-01, HELP-01 to HELP-04, MOD-02) passes at 1280; the only reds were `verify:design` text checks, caused by the throwaway's raw markup, not by the feature.
**Builder rules this gives:** (1) no request on any HR page until Ask Batsi is opened (ONB-02, 12, 13, 15 forbid any other host); (2) load the chat code lazily so no URL fetched on HR pages names Batsi (ONB-15 AC-10 forbids a "Batsi" route); (3) use the DS panel, card and button only (`verify:design` runs in ONB-05, 06, 17, 20, 24 and ANG-01), the top bar button needs a DS class, and the icon must be `sparkles`.
(4) **No file path or class name under the signed-in app may contain "batsi"** (guard test in `chat-01.spec.ts`). The Angular dev server puts the component path in its hot-reload URL (`/@ng/component?c=...`), and ONB-12 AC-9, ONB-13 AC-9 and ONB-15 AC-10 forbid any URL containing "batsi". Use e.g. `features/hr-assistant/assistant-panel.ts` and class `HrChat`. Button and CSS class names are not paths, but keep them free of it too. (5) The builder's pull request can only merge after ONB-19's, because this lock sits on top of ONB-19's lock (155f248).
