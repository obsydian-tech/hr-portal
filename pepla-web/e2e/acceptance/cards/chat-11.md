# CHAT-11

Card: CHAT-11 Ask Batsi: the suggested questions look like the design (spec date 19 Nov 2026, tier green)

Test files: `chat-11.spec.ts`

Spec: `/mnt/project-files/ask-batsi-chat/CHAT-11-suggestion-buttons.md` (AC-1 to AC-7). No new words: the questions are the approved W05 to W07 of CHAT-01.

Locks: acceptance-lock/chat-11

These tests add files only; no other card's file changed. They import `support/chat-01/chat-fake.ts` without changing it.

## How the tests run

All run at 1280 and 390 wide with no backend (no-backend run only, none on pepla-dev). Cognito is the shared fake; the Agent API is answered by the CHAT-01 fake.

The tests compare the app's question rows with the design system's own row: they add one `a.pp-agent-panel__suggestion` (as the kit draws it) to the end of the same list and require each question button to have the same computed look (fill, borders, corners, shadow, spacing, colour, font, alignment, cursor, appearance, opacity, height), the same hover colour and the same keyboard focus ring. So the tests follow the design system: if the design system changes the row, the app follows after a sync and the tests still pass.

## Before the build

On develop 4c96a7f: AC-1, AC-2, AC-3 and AC-6 fail at both widths (12 of 18). AC-4, AC-5 and AC-7 pass: picking, the keyboard and wrapping work today and are kept as guards so the fix cannot break them.

## The contract these tests fix where the card is silent

1. A question stays a `button` with class `pp-agent-panel__suggestion` inside the list named "Tasks Batsi can do", with an icon `svg` and the words in a `span`.
2. Offline uses the design system tokens `--color-text-disabled` (words) and `--color-icon-subtle` stays the icon colour when enabled.
3. The suggestions stay inside the log "Conversation with Batsi".

## Proof (19 Nov 2026, develop 4c96a7f)

- Today's develop: 12 of 18 fail (AC-1, 2, 3, 6 at both widths); AC-4, 5, 7 pass (guards, see above).
- A throwaway correct version (the design system rule for button rows, pasted into the synced `components.css`, not committed): 18 of 18 pass.
- Planted faults, each on the throwaway version: no full width (AC-1); grey fill kept (AC-2, 3, 6); border kept (AC-2); centred text (AC-2); no hand (AC-2, 3); no disabled colour (AC-6); hover colour while disabled (AC-6); shortened label (AC-7); focus ring removed (AC-5); a row asks other words (AC-4, 5); rows not disabled offline (AC-6); words cut to one line by a height limit, and by a line clamp (AC-7, added after the independent check: the row's words must not be cut at the side or at the bottom). All caught. Dropping `box-sizing: border-box` is not caught, and is not a fault: Chromium gives buttons border-box already.
