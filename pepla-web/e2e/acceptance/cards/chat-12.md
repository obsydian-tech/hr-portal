# CHAT-12

Card: CHAT-12 The Ask Batsi message box stays pinned: full page and side panel (19 Nov 2026, tier green, no new words)

Test file: `chat-12.spec.ts` (uses `support/chat-01/chat-fake.ts` as it is; no new support file)

Locks: acceptance-lock/chat-12

These tests add files only; no other card's file changed.

## What the card asks (Iggie, 19 Nov, his words in the thread)

The full page scrolled as a whole, so the box and the header scrolled away once answers got long. Wanted: the way ChatGPT and Claude do it. The message box stays at the bottom of the screen, the header stays at the top, the conversation scrolls on its own between them and the view follows the newest message. Both the side panel and the full page.

## The tests

AC-1 to AC-5 are the full page (`/hr/ask-batsi`). AC-6 and AC-7 are the side panel. All run at 1280 and 390 wide, in the no-backend run only. Each builds a conversation of four long answers with the fake Agent API.

1. AC-1 Nothing scrolls except the conversation: the window and the page area do not scroll, the message box, the box to type in and Send are on screen and sit at the bottom, and the conversation is taller than its own area.
2. AC-2 Scrolling the conversation to its start moves nothing else: the header (Back to Today, the title) and the message box are in the same place.
3. AC-3 A new answer is followed: the newest answer is inside the conversation area and the conversation is at its end.
4. AC-4 A person who scrolled up while a slow answer was coming is not pulled down when it arrives.
5. AC-5 A message of twelve lines grows the box but it stays on screen.
6. AC-6 Side panel: the message box and Close stay on screen and do not move when the conversation scrolls.
7. AC-7 Scrolling the conversation in the side panel does not scroll the page behind it.

## Before and after

On develop at 4c96a7f the full page fails AC-1, AC-2, AC-3 and AC-5 at both widths (8 tests); AC-4, AC-6 and AC-7 already pass there and stay in as guards (the side panel was already pinned). With the fix 14 of 14 pass.

Two causes, both in the design system: the full page was given a height worked out from the top bar and the page's padding, which does not add up to the real page area; and the browser's 8 px page margin made the whole window 16 px taller than the screen, so the window scrolled on every signed-in page. A third, found while testing: the hidden "You said:" labels sat outside the scroll area and made the page area think it was taller than it is.

## Shared files

Reads `support/chat-01/*`, `support/fixtures`, documents and employees fakes. Touches no locked test. The fix is design system CSS (components.css, synced) and one line removed from `src/app/ds/agent/panel.ts`.
