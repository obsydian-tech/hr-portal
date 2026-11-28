# REC-UI-02.10

Card: REC-UI-02 board hint. Say why Board is greyed out on the Pipeline list. Jira NH-313 (parent NH-223, amber: screen words only, no `lambda/`, `api/`, `infra/` or design system change).

Test file: new `rec-ui-02-board-hint.spec.ts`. It reuses `support/rec-ui/harness.ts` (REC-UI-01) and `support/rec-ui-02/lists.ts` (REC-UI-02 step 1) unchanged.

Spec: `onboarding-cards/specs/REC-UI-02-board-hint.md` (rules 1 to 6, AC-BH1 to AC-BH6), its checks `REC-UI-02-board-hint-SPEC-CHECK-R1.md` (F-1 to F-6) and `-R2.md` (pass, E-1, E-2). Words: Iggie's own, approved 28 Nov 2026 16:44 SAST (D-RUI-02.38): "Choose one role to see its board." The full stop stays (tooltip.md's "no full stop" is set aside for his words, D-RUI-02.39).

Locks: acceptance-lock/rec-ui-02.10, one squashed commit on develop. **No locked line moves.** The locked `toBeDisabled` lines of `rec-ui-02.spec.ts` AC-1 (481, 517, 528) and `toBeEnabled` (504) stay green because Playwright counts `aria-disabled="true"` as disabled. The test writer ran `rec-ui-02.spec.ts`, `rec-ui-02-add.spec.ts`, `rec-ui-01.spec.ts`, and the Pipeline tests of `rec-ui-02-record.spec.ts` and `rec-ui-04.spec.ts` on the throwaway build.

## How the tests run

Every test runs at 1280 and 390 wide unless it says why not. Page time is the harness clock (19 Nov 2026 10:00 in Johannesburg). The harness answers the list as REC-15 step A does; roles are Fleet controller, Warehouse supervisor and Senior accountant.

The AC-BH1 / AC-BH4 `@pepla-dev` test runs on pepla-dev only, as `E2E_HR_*`, at both widths. It needs no seed: it picks the first role the HR login's Role filter lists.

## For the builder

1. In `pipeline-list.page.ts`, while no role is chosen, Board carries `aria-disabled="true"` and no `disabled`. With a role chosen it carries neither (no `aria-disabled="false"`). Keep `board()`'s `if (this.s.role)` guard.
2. Desktop (wider than 767 px): wrap only Board in `<pp-tooltip text="Choose one role to see its board.">`, inside the existing `pp-button-group`. No visible line, no `title`, no page-wide Escape listener.
3. Phone (767 px or less, `BreakpointObserver` `(max-width: 767px)` as in `candidate-record.page.ts`): no `pp-tooltip`. Put the `pp-button-group` and one `<span class="pp-text pp-text--small pp-text--subtle" id="...">` with the words, in that order, in one `pp-stack pp-gap-*` wrapper that is a direct child of `.pp-page-header__actions`. Board's `aria-describedby` is that id. "Add candidate" stays where it is, a direct child of `.pp-page-header__actions`.
4. With a role chosen, the header is today's markup: no tooltip, no line, no wrapper.
5. The words appear once in the page at each width. Write them exactly, full stop included.

A working version that passes every test is in `onboarding-cards/rec-ui-02-board-hint/THROWAWAY-NOT-FOR-MERGE.patch`. It is not for merge.

## Decisions where the spec is silent (test writer, 28 Nov; the builder follows these)

- T-BH1: "appears in the page once" (AC-BH1) counts every element whose own text holds the words and every attribute value that holds them (a `title` or `aria-label` copy counts). There must be exactly one copy, and its whole text is the line and nothing else. It is counted with the tooltip closed (spec check R2 E-2).
- T-BH2: "after the delay" (AC-BH2) is judged by in-page times: the tooltip first shows at least 200 ms after the pointer enters Board. "At once" on keyboard focus is judged as less than 250 ms after the Tab key press. Both are read with `performance.now()` inside the page, so a slow test machine cannot change the result.
- T-BH3: the tooltip "shows" when an element with `role="tooltip"` holding the words is visible (pp-tooltip's floating copy). The always-there description (`pp-visually-hidden`, no role) does not count as showing.
- T-BH4: "Tab reaches Board" is judged by focusing List and pressing Tab at most three times until Board has focus. A `disabled` Board fails here.
- T-BH5: "Board does nothing" (rule 2) is judged by a forced pointer click (both widths) and by Enter and Space while Board has focus (desktop): the address stays the same and no board shows.
- T-BH6: the desktop check that nothing shows the words before hover counts visible copies larger than 2 by 2 px that are not hidden by visibility, opacity or display. The 1 px screen reader description is not a visible copy.
- T-BH7: "the header is no taller" (AC-BH6, desktop) compares `.pp-page-header` on the All roles list with the same list for Fleet controller (`role=role-fleet&view=list`), which has no hint. Up to 1 px is allowed.
- T-BH8: on phone the line must sit under the switch (its top at or below the switch group's bottom), be in the first screen, not be covered, and its words must not spill out of it.

## Not caught by these tests (for the build review)

- A page-wide Escape listener (rule 3 says not to add one). A test cannot tell it apart from pp-tooltip's own Escape while focus is on Board.
- Firefox, Safari and a real screen reader (not run here; spec "Dev check after merge").
- The new spec has no entry in `scripts/ci/acceptance-spec-seconds.json` yet; card NH-296 refreshes that list.
