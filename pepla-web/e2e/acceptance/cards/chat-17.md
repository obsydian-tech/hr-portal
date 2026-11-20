# CHAT-17

Card: CHAT-17 Ask Batsi chat list: a clean list, "No chats yet.", and the last chat on arrival (spec date 20 Nov 2026, tier red)

Test files: `chat-17.spec.ts`. Uses CHAT-14's fake (`support/chat-14/chats-fake.ts`) and CHAT-01's fake as they are.

Source: `/mnt/project-files/ask-batsi-chat/CHAT-17-chat-list-look-and-reload.md`. Iggie, 20 Nov 2026: a clean list like Gemini and Claude ("okay with the previews"), and "My last chat" for what a reload shows. The only new words are "No chats yet." (W16-1, logged in DECISIONS.md). CHAT-16 is replaced by this card; its tests are folded in here and its lock is never pushed. Iggie, 20 Nov 2026 18:50 SAST ("Match full page"): the side panel starts on the last chat too and has a New chat button with the full page's words (AC-27 to AC-31; no new words).

Locks: `acceptance-lock/chat-17` and the child lock `acceptance-lock/chat-14.1`, on the same commit. The child lock changes only the helper `onFullPage` in `chat-14.spec.ts` (and the note in `cards/chat-14.md`): loading the full page now opens the last chat by itself, so the helper waits for that, presses New chat and leaves the one opening read out of the fake's record. Every CHAT-14 test then starts from the new chat it was written for. CHAT-01, 11, 12 and 13 need no child lock: their fakes do not answer `/v1/chats`, the read fails, and the page stays on a new chat (AC-21 here pins that).

## How the tests run

All run at 1280 and 390 wide, no backend (no-backend run only). The look is read from the browser's computed styles: a border counts only if it has width, a style and a colour that shows; a fill only if it is not see-through; a mark is a `::before` or `::after` that paints. The pointer is moved away and focus dropped before the look is read, so hover and press colours do not count.

| AC | What it requires |
|---|---|
| AC-1 | Chat rows: no border, fill, shadow, mark or icon. The open chat: its own fill, no border, shadow, accent bar or icon. New chat, Search chats, Delete all my chats: one icon each. All rows share one left edge and one width, filling the column. |
| AC-2 | A long title ends in an ellipsis on one line; a short one is whole; nothing in the column ends past its right edge or scrolls sideways. |
| AC-3 | New chat, Search chats, Delete all my chats and Delete chat: no border, fill or shadow at rest. |
| AC-4 | Contrast 4.5 to 1 or more for every row's words; a row reached with Tab shows a focus ring. |
| AC-5 | No words in the column or the chat header other than the approved ones and the titles. |
| AC-6 to AC-9 | "No chats yet.": where and how it shows; when it does not (loading, failing, switched off, with chats, a search with no match); never in the side panel or the conversation; after Delete all. |
| AC-10 to AC-19 | The last chat on arrival: which chat, one read after the list, from the list and not the browser, the first page is enough, nothing to open, New chat stays blank, the person acts first, Open as a full page keeps the panel's chat (the last chat the panel opened, or a blank one after the panel's New chat), failures (500, 404, 403), focus does not move, phone. |
| AC-23 to AC-26 | Found in the independent check: a question in the chat that opened by itself carries its id; Back to Today and the panel show that chat; a dropped opening shows "We could not open this chat."; a 404 reads the list again and the gone chat leaves it. |
| AC-27 to AC-31 | The side panel: on a fresh visit it starts on the last chat (once, focus not moved, the person first, a chat on screen kept); its New chat button; nothing to open (empty, failing, switched off, the opening fails, 404); nothing read before the panel opens. |
| AC-20 | Company B on the same browser: A's late opening answer never shows; B's reload opens B's own last chat; every call after sign-out carries B's token. |
| AC-21, AC-22 | Guards: an unanswered list stays on a new chat and usable; no AI host. |

## The contract these tests fix where the card is silent

1. "The most recently updated chat" is the one with the latest `updated` in the first page of the list. The seeded chats put it third and give it a higher number than others, so neither order nor number can pick it by chance.
2. "Loading the page" is `page.goto` or `page.reload`. "Open as a full page" from the panel is not loading the page. The panel's opening happens when the top bar's Ask Batsi button opens it, first on a visit, with a blank conversation.
3. "No chats yet." is found by its exact words and must be a `status`. Its place is checked against Search chats and the column's box.
4. The focus ring is an outline with width or a box shadow while the row has keyboard focus.
5. The panel's New chat is a button named exactly "New chat" inside the panel's dialog.

## Proof

Run by the writer on 20 Nov 2026 against develop `60df6b4` and a throwaway build (`chat-17-throwaway-build-NOT-FOR-MERGE.patch`). Numbers and planted faults are in `CHAT-17-tests-for-review.md`.
