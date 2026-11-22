# CHAT-14

Card: CHAT-14 Ask Batsi past chats: the list, opening an old chat, and deleting chats (screens) (spec date 19 Nov 2026, tier red)

Test files: `chat-14.spec.ts`, `support/chat-14/chats-fake.ts`

Source: `/mnt/project-files/ask-batsi-chat/CHAT-14-past-chats-screens.md`. Words are the approved ones in that spec (P36 to P39, W14-1 to W14-5, the failure lines); the tests add none.

Locks: acceptance-lock/chat-14, and the child lock chat-12.1 (changes only the two heading lookups in `chat-12.spec.ts` AC-2, after PR 438 merges).

Child lock chat-14.1 (CHAT-17, 20 Nov 2026): loading the full page now opens the person's last chat once the list answers (Iggie's choice "My last chat"; CHAT-17 replaces section 3's "A reload opens a new chat"). The helper `onFullPage` changes: when chats are stored, the switch is on and the list answers, it waits for that opening, presses New chat, and leaves the one opening read out of the fake's `calls`. Iggie's later choice the same day ("Match full page", 18:50 SAST) makes the side panel start on the last chat too and gives it a New chat button, so four test bodies change, each only where that rule touches it: AC-8 no longer says the panel has no "New chat" (still no list, no delete, no search); AC-23 "a list answer/failure for A after B signed in" waits for A's held list reads (now two: the panel's and the page's) instead of exactly one; the two AC-23 tests about B's first question and B's chat staying New chat seed B with no chats, so B's panel stays on a new chat as those tests need. No word changes. Tests that load the page another way (AC-3 with 120 chats, AC-13, AC-25) are unchanged and pass: see the table in CHAT-17-chat-list-look-and-reload.md.

These tests add files only. They use the shared fakes (`DocumentsFake`, `EmployeesFake`, the Cognito fake) and the new `ChatsFake`; they do not change `support/chat-01/chat-fake.ts` or any other locked file. AC-25 imports the CHAT-01 fake as it is.

## How the tests run

All run at 1280 and 390 wide, no backend (no-backend run only, none on pepla-dev). Cognito is the shared fake. `ChatsFake` answers `GET /v1/chats` (with `nextToken` pages), `GET /v1/chats/{id}`, `DELETE /v1/chats/{id}`, `DELETE /v1/chats` and the question route `POST /agent/v1/ai-chat` (with a `chatId`) on any host that is not the app. It keeps a separate store per signed-in person, keyed by the e-mail in the ID token, so a second company is a second store. Every call is recorded. The fake raises a violation, and the spec fails, for any extra header, any query other than `nextToken`, any body on the chats calls, or any person, company or chat owner in a path or body.

| AC | What it requires |
|---|---|
| AC-1 | The column on `/hr/ask-batsi`: Back to Today (desktop), New chat, Search chats, groups Today, Yesterday, Previous 7 days with titles newest first, Delete all my chats last; the app's own sidebar items are not there. |
| AC-2 | South African days and months, at 23:30 SAST; also in a Los Angeles browser time zone and at 00:10 SAST; month-and-year headings newest first. |
| AC-3 | 120 chats over three pages are all shown and searchable; a list that never stops giving `nextToken` stops at 20 pages. |
| AC-4 | The message box and the line under it keep their size when the list or a dialog opens; the column scrolls by itself on desktop. |
| AC-5 | Open an old chat: one read, title as heading, messages in order with their times, no suggested questions, current item, focus on the heading, Delete chat shown; a chat not stored yet has no Delete chat. |
| AC-6, AC-7 | A question in an old chat carries its chat id and the list is read again; a new chat sends no chat id first, then the id the answer gave; the server's title shows, not the typed words. |
| AC-8 | One chat in the panel and the page; the panel shows no list and no Delete chat. |
| AC-9 to AC-11 | Delete chat, Delete all my chats and failing deletes (500, dropped, offline): dialogs, focus, one request each, 404 counts as done, "It did not go through. Nothing was changed.". |
| AC-12 to AC-16 | Empty, loading, failing (500, dropped, 200 without a list, no answer at all), a chat that will not open, a chat that is gone, switched off (403, Delete all still works). |
| AC-17 | Search: focus, case, across groups, no request while typing, "No chats found.", Escape. |
| AC-18, AC-19 | Phone: header, menu button opens the list, nothing under the top bar, no sideways scroll; both dialogs fit. |
| AC-20 | Keyboard: Tab order (desktop), every delete step by keyboard (both widths). |
| AC-21 | Landmark, group lists named by headings, current item, alerts and status. |
| AC-22 | Titles and messages are text only; nothing in local storage, session storage or IndexedDB. |
| AC-23 | Company B on the same browser sees none of company A's words at any moment (a held list read, a late answer for A is dropped); every chats call carries the person's own token. |
| AC-24 | A late answer stays in its own chat, also after New chat. |
| AC-25 | Guard: where `/v1/chats` is not answered (CHAT-01's fake), the page stays usable. The older locks themselves are run in the proof below. |
| AC-26 | Guard: no request reaches an AI host, and a whole visit calls only the fake. |

## The contract these tests fix where the card is silent

1. The list is the navigation landmark named "Chats". Its items are links or buttons named by the chat's title.
2. On a phone the closed list may be off the screen or hidden; "shown" means inside the screen. The top bar menu button opens and closes it, and it opens under the top bar.
3. The loading state is `aria-busy="true"` with no words other than the ones the card names.
4. Both delete dialogs may be `dialog` or `alertdialog`. Each has a Close (x) button, closes on Escape, and puts focus on Cancel. The design system's danger dialog has none of these today, so the build adds them (not named in the card's design system list).
5. The Tab order in AC-20 is checked on desktop only; the keyboard delete tests run at both widths.
6. Company B is a second `hr_staff` person on another e-mail domain; the fake tells the companies apart by the e-mail in the token (the real server does it from the membership row).

## Proof

Run by the writer on 19 Nov 2026 against develop and a throwaway correct build; after the independent check four tests were added (B’s first question has no chat id; A’s late answer after sign-out; Delete all with a search open; an empty list has no sentence). Numbers are in `CHAT-14-tests-for-review.md`.
