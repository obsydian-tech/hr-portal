# CHAT-13

Card: CHAT-13 Ask Batsi: the message box and the line under it are never cut off (spec date 19 Nov 2026, tier green)

Test files: `chat-13.spec.ts`

Source: found in the CHAT-11 build review (`/mnt/project-files/ask-batsi-chat/CHAT-11-build-review.md`, "Not part of this card"). Design system first: pepla-design-system PR 60 (`fix/chat-13-composer-hint`). No new words: the box says "Ask anything about <first name>" and the line under it says "Batsi changes nothing until you approve.", both exactly as approved in CHAT-01.

Locks: acceptance-lock/chat-13

These tests add files only; no other card's file changed. They import `support/chat-01/chat-fake.ts` and the `chat-11` style setup without changing any of it.

## How the tests run

All run at 1280 and 390 wide with no backend (no-backend run only, none on pepla-dev). Cognito is the shared fake; the Agent API is answered by the CHAT-01 fake. AC-4 runs at 390 only.

| AC | What it requires |
|---|---|
| AC-1 | The words in the message box (side panel on a person with a long first name, and the full page) are all shown: no line cut at the bottom or the side. |
| AC-2 | The line under the box reads in full, and sits inside the screen and inside the panel (panel and full page). |
| AC-3 | The box grows with what is typed: three lines all shown, taller than when empty; twelve lines stop at about four lines and scroll inside; Send and the line under the box stay in view. |
| AC-4 | Phone only: the side panel is as tall as the screen the person can see (top at 0, bottom at the bottom of the visible screen). |
| AC-5 | Guard: the line under the box reads exactly the approved sentence, and Send and typing still work. |

## Before the build

On develop d262f7d: 5 of 17 fail. AC-1 (panel, phone) fails because the second line of the box's words is cut off; AC-3 fails in the panel and on the full page at both widths because the box never grows. AC-2, AC-4 and AC-5 pass today and are kept as guards. The cut-off line under the box was NOT reproduced: in Chromium at 320, 360 and 390 wide the line is whole and inside the panel. The change to the design system (`flex: none`, wrapping, `100dvh` sheet) is a defence for phone browser bars and large text that the tests hold in place; it needs a look on a real phone.

## The contract these tests fix where the card is silent

1. The box is the textbox named "Message Batsi"; the line under it is `.pp-agent-panel__hint`.
2. "Grows to four lines" means: its height stops at four line heights plus 40 px, and what is typed beyond that scrolls inside the box.
3. The panel's visible bottom is `window.visualViewport.height`.

## Proof (19 Nov 2026)

- Today's develop d262f7d: 5 of 17 fail (above).
- With the design system change synced from PR 60 (c817616) and the app's size fallback: 17 of 17 pass (AC-4 skipped at 1280 by design).
- The same run with the browser's own box sizing switched off (older Safari): 17 of 17 pass, so the fallback in `ds/agent/panel.ts` does the work there.
- Planted faults on the synced `components.css`, each caught: the line under the box cut by a height limit (AC-2, 4 tests); box sizing off (AC-1 panel on phone, AC-3); no four-line cap (AC-3); phone sheet 90dvh instead of the visible screen (AC-4).
