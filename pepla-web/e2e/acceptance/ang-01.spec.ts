import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { ON_DEV, expect, test } from './support/fixtures';
import { forgetSignIn } from './support/sign-in-again';
import { EMPLOYEE_BAR, HR_BAR, PARITY_BARS } from './support/ang-01/develop-bars';
import {
  DS_DIR,
  PEPLA_WEB,
  SECTIONS,
  WORDS,
  barControls,
  card,
  chooseStage,
  chosenStage,
  column,
  dialog,
  dragCardTo,
  drawsGrid,
  git,
  launcher,
  launcherClicks,
  launcherOpenToggle,
  moveButton,
  moveFirst,
  moveTo,
  moveToday,
  openFromButton,
  openParity,
  pickCards,
  pickerCounts,
  readBoard,
  reason,
  requests,
  showStage,
  stageOf,
  stageOptions,
  theSection,
  visibleBlocks,
  wordShown,
  type Column,
} from './support/ang-01/gallery';

/**
 * ANG-01 · Board asks first when a card moves, and the Modules button (Jira NH-233, epic NH-223).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ANG-01.md (NH-233). Notes: ./cards/ang-01.md.
 *
 * `pp-pipeline-board` gets `confirmMoves`: a drop or the card's Move button opens the Move dialog, and the card
 * moves only after a reason, when the screen applies the request. `pp-top-navigation` gets the Modules button
 * (`showLauncher`, off by default). Every test finds its sections on /dev/parity by data-parity name and drives the
 * dev-only hooks the card names: data-testid="move-requests", the button "Apply request",
 * data-testid="launcher-clicks" and the launcherOpen toggle.
 *
 * Each test runs at 1280 and 390 wide unless it says why not. No criterion runs on pepla-dev.
 * Nothing here calls an AI service. These files are locked once accepted: see ./README.md.
 */

const once = (why: string) => test.skip(test.info().project.name !== 'desktop-1280', `Runs once, in desktop-1280: ${why}`);
const desktopOnly = (why: string) => test.skip(test.info().project.name !== 'desktop-1280', why);
const phone = () => test.info().project.name === 'phone-390';
const project = () => test.info().project.name as 'desktop-1280' | 'phone-390';
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.skip(ON_DEV, 'ANG-01 has no pepla-dev criterion: the gallery is checked in the no-backend run.');

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const counts = (b: Column[]) => Object.fromEntries(b.map((c) => [c.stage, c.count]));
const cardsOf = (b: Column[]) => Object.fromEntries(b.map((c) => [c.stage, c.cards]));

/** The board's own Move button of a card (ask-first name). */
const moveOf = (scope: Locator, fullName: string) => card(scope, fullName).getByRole('button', { name: moveFirst(fullName), exact: true });

async function askFirst(page: Page): Promise<{ s: Locator; board: Column[]; dialogs: number }> {
  await openParity(page);
  const s = await theSection(page, SECTIONS.askFirst);
  const board = await readBoard(s);
  expect(board.length, '"Move asks first" shows a board').toBeGreaterThan(1);
  return { s, board, dialogs: await page.getByRole('dialog').count() };
}

/** No dialog opened: the gallery shows some dialogs in place on purpose, so the count stays what it was. */
async function expectNoDialog(page: Page, gallery: number): Promise<void> {
  await expect(page.getByRole('dialog'), 'no dialog is open (beyond the gallery\'s own examples)').toHaveCount(gallery);
}

/** The card is still where it was: same column, same place, counts unchanged, and the screen was asked nothing. */
async function expectUnmoved(s: Locator, before: Column[]): Promise<void> {
  const now = await readBoard(s);
  expect(cardsOf(now), 'every card is where it was').toEqual(cardsOf(before));
  expect(counts(now), 'every count is unchanged').toEqual(counts(before));
}

test.describe('ANG-01 Board asks first, and the Modules button', () => {
  // ================================================================ Board
  // -------------------------------------------------------------- AC-1
  test('AC-1 Today\'s board is unchanged: the Move menu moves at once and says so, and a drop moves at once', async ({ page }) => {
    await openParity(page);
    const s = await theSection(page, SECTIONS.today);
    const dialogs = await page.getByRole('dialog').count();
    const before = await readBoard(s);
    const { forward } = pickCards(before);
    await showStage(s, forward.from);

    // Every card the page shows has today's Move button name.
    for (const col of before) {
      if (!(await column(s, col.stage).isVisible())) continue;
      for (const name of col.cards) await expect(card(s, name).getByRole('button', { name: moveToday(name), exact: true }), `${name}'s Move button keeps today's name`).toBeVisible();
    }

    const b = card(s, forward.name).getByRole('button', { name: moveToday(forward.name), exact: true });
    const menusBefore = await page.getByRole('menu').count(); // the gallery shows some menus open on purpose
    if (phone()) await b.tap(); else await b.click();
    await expect(page.getByRole('menu'), 'the Move button opens one more menu').toHaveCount(menusBefore + 1);
    const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: `Move to ${forward.to}`, exact: true }) });
    await expect(menu, 'the Move button opens a menu').toBeVisible();
    await expectNoDialog(page, dialogs);
    const others = before.map((c) => c.stage).filter((st) => st !== forward.from);
    await expect(menu.getByRole('menuitem'), 'the menu lists "Move to {stage}" for every other stage').toHaveText(others.map((st) => `Move to ${st}`));
    const item = menu.getByRole('menuitem', { name: `Move to ${forward.to}`, exact: true });
    if (phone()) await item.tap(); else await item.click();

    await expectNoDialog(page, dialogs);
    const after = await readBoard(s);
    expect(stageOf(after, forward.name), 'the card moved at once').toBe(forward.to);
    expect(after.find((c) => c.stage === forward.from)!.count, 'the old column counts one fewer').toBe(before.find((c) => c.stage === forward.from)!.count - 1);
    expect(after.find((c) => c.stage === forward.to)!.count, 'the new column counts one more').toBe(before.find((c) => c.stage === forward.to)!.count + 1);
    await expect(s.locator('[aria-live]'), 'the live region says the move').toHaveText(`${forward.name} moved to ${forward.to}`);
    if (phone()) {
      const shown = await pickerCounts(s);
      expect(shown[forward.from], 'the stage picker counts one fewer in the old stage').toBe(before.find((c) => c.stage === forward.from)!.count - 1);
      expect(shown[forward.to], 'the stage picker counts one more in the new stage').toBe(before.find((c) => c.stage === forward.to)!.count + 1);
      return; // the phone board is one list with no drag
    }

    // A drop still moves at once.
    const mid = await readBoard(s);
    const other = mid.find((c) => c.cards.length > 0 && c.stage !== forward.to && mid.indexOf(c) < mid.length - 1)!;
    const target = mid[mid.indexOf(other) + 1].stage;
    await dragCardTo(page, s, other.cards[0], target);
    await expectNoDialog(page, dialogs);
    const dropped = await readBoard(s);
    expect(stageOf(dropped, other.cards[0]), 'a drop moves the card at once').toBe(target);
    expect(dropped.find((c) => c.stage === target)!.count, 'and the count updates').toBe(mid.find((c) => c.stage === target)!.count + 1);
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 A drop asks first: the Move dialog opens on the column dropped on, and the card stays where it was', async ({ page }) => {
    desktopOnly('Desktop only, as the card says: the phone board is one list with no drag.');
    const { s, board } = await askFirst(page);
    const { forward } = pickCards(board);
    await dragCardTo(page, s, forward.name, forward.to);
    const d = dialog(page, forward.name);
    await expect(d, `a dialog titled "${moveFirst(forward.name)}" opens`).toBeVisible();
    await expectUnmoved(s, board);
    expect(stageOf(await readBoard(s), forward.name), 'the card is still in its original column').toBe(forward.from);
    expect(await requests(s), 'no request is listed').toEqual([]);
    expect(await chosenStage(d), '"Move to" shows the column it was dropped on').toBe(forward.to);
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 Every card\'s Move button opens the same dialog, not a menu, on the card\'s own stage, by mouse, tap, Enter and Space', async ({ page }) => {
    const { s, board } = await askFirst(page);
    // Every card has a button named "Move {first name}" (on a phone, stage by stage).
    for (const col of board) {
      await showStage(s, col.stage);
      for (const name of col.cards) await expect(moveOf(s, name), `${name}'s card has a button named "${moveFirst(name)}"`).toBeVisible();
    }
    const { forward } = pickCards(board);
    await showStage(s, forward.from);
    const menus = await page.getByRole('menu').count(); // the gallery shows some menus open on purpose
    for (const how of [phone() ? 'tap' : 'click', 'Enter', 'Space'] as const) {
      const d = await openFromButton(page, s, forward.name, how);
      await expect(page.getByRole('menu'), `${how} opens no menu`).toHaveCount(menus);
      await expect(page.getByRole('menuitem', { name: /^Move to / }), `${how}: no "Move to {stage}" menu item`).toHaveCount(0);
      expect(await chosenStage(d), `${how}: "Move to" starts on the card's own stage`).toBe(forward.from);
      await d.getByRole('button', { name: WORDS.cancel, exact: true }).click();
      await expect(d).toBeHidden();
    }
    await expectUnmoved(s, board);
  });

  // -------------------------------------------------------------- AC-4
  test('AC-4 A reason is required: Move is disabled with no reason, only spaces, or the same stage, and nothing is emitted while it is', async ({ page }) => {
    const { s, board } = await askFirst(page);
    const { forward } = pickCards(board);
    await showStage(s, forward.from);
    const d = await openFromButton(page, s, forward.name, phone() ? 'tap' : 'click');
    const move = moveButton(d);
    const tryMove = async () => {
      await move.click({ force: true });
      await move.press('Enter').catch(() => undefined);
    };

    await expect(move, 'empty reason, own stage: Move is disabled').toBeDisabled();
    await tryMove();
    await reason(d).fill('     ');
    await expect(move, 'only spaces, own stage: disabled').toBeDisabled();
    await chooseStage(d, forward.to);
    await expect(move, 'only spaces, another stage: disabled').toBeDisabled();
    await tryMove();
    await reason(d).fill(' \n\t  ');
    await expect(move, 'only blank characters, another stage: disabled').toBeDisabled();
    await tryMove();
    await reason(d).fill('');
    await expect(move, 'empty reason, another stage: disabled').toBeDisabled();
    await tryMove();
    await reason(d).fill('Strong interview');
    await chooseStage(d, forward.from);
    await expect(move, 'a reason, but the card\'s own stage: disabled').toBeDisabled();
    await tryMove();
    await expect(d, 'the dialog stays open while Move is disabled').toBeVisible();
    expect(await requests(s), 'nothing is emitted while Move is disabled').toEqual([]);
    await chooseStage(d, forward.to);
    await expect(move, 'a reason and another stage: Move is enabled').toBeEnabled();
    expect(await requests(s), 'still nothing until Move is pressed').toEqual([]);
    if (phone()) return; // no drag on the phone board

    // Opened by a drop, the same rule holds: set "Move to" back to the card's own stage and Move is disabled again.
    await d.getByRole('button', { name: WORDS.cancel, exact: true }).click();
    await expect(d).toBeHidden();
    await dragCardTo(page, s, forward.name, forward.to);
    const dropped = dialog(page, forward.name);
    await expect(dropped, 'a drop opens the dialog').toBeVisible();
    const mv = moveButton(dropped);
    await expect(mv, 'after a drop, empty reason: disabled').toBeDisabled();
    await reason(dropped).fill('Strong interview');
    await expect(mv, 'after a drop, a reason and the column dropped on: enabled').toBeEnabled();
    await chooseStage(dropped, forward.from);
    await expect(mv, 'after a drop, a reason but the card\'s own stage: disabled').toBeDisabled();
    await mv.click({ force: true });
    await mv.press('Enter').catch(() => undefined);
    await expect(dropped, 'the dialog stays open while Move is disabled').toBeVisible();
    expect(await requests(s), 'after a drop, nothing is emitted while Move is disabled').toEqual([]);
    await expectUnmoved(s, board);
  });

  // -------------------------------------------------------------- AC-5
  test('AC-5 Confirming asks the screen to move the card: one request with the trimmed reason; "Apply request" moves it and its Move button holds focus', async ({ page }) => {
    const { s, board, dialogs } = await askFirst(page);
    const { forward } = pickCards(board);
    await showStage(s, forward.from);
    const d = await openFromButton(page, s, forward.name, phone() ? 'tap' : 'click');
    const optionValues = await d.getByLabel(WORDS.field, { exact: true }).evaluate((sel: HTMLSelectElement) => Object.fromEntries([...sel.options].map((o) => [o.textContent!.trim(), o.value])));
    await chooseStage(d, forward.to);
    await reason(d).fill('   Strong interview, ready for the next step  \n ');
    if (phone()) await moveButton(d).tap(); else await moveButton(d).click();
    await expect(d, 'Move closes the dialog').toBeHidden();
    await expectNoDialog(page, dialogs);

    const listed = await requests(s);
    expect(listed.length, 'exactly one request is listed').toBe(1);
    const r = listed[0] as { card: { id?: unknown; name?: unknown }; from: unknown; to: unknown; reason: unknown };
    expect(typeof r.card === 'object' && r.card !== null, 'the request carries the card').toBe(true);
    expect(typeof r.card.id === 'string' && (r.card.id as string).length > 0, 'the request carries the card id').toBe(true);
    expect(r.card.name, 'the request is for this card').toBe(forward.name);
    expect([optionValues[forward.from], forward.from], 'from is the card\'s own stage').toContain(r.from);
    expect([optionValues[forward.to], forward.to], 'to is the chosen stage').toContain(r.to);
    expect(r.reason, 'the reason has no leading or trailing spaces').toBe('Strong interview, ready for the next step');
    await expectUnmoved(s, board);

    // The screen applies it.
    const apply = s.getByRole('button', { name: 'Apply request', exact: true });
    if (phone()) await apply.tap(); else await apply.click();
    const after = await readBoard(s);
    expect(stageOf(after, forward.name), '"Apply request" moves the card').toBe(forward.to);
    expect(after.find((c) => c.stage === forward.from)!.count, 'the old column counts one fewer').toBe(board.find((c) => c.stage === forward.from)!.count - 1);
    expect(after.find((c) => c.stage === forward.to)!.count, 'the new column counts one more').toBe(board.find((c) => c.stage === forward.to)!.count + 1);
    if (phone()) {
      const shown = await pickerCounts(s);
      expect([shown[forward.from], shown[forward.to]], 'the stage picker shows both new counts').toEqual([board.find((c) => c.stage === forward.from)!.count - 1, board.find((c) => c.stage === forward.to)!.count + 1]);
      return; // on a phone the new column is not the one on screen, so nothing there can hold focus (card note)
    }
    await expect(column(s, forward.to).getByRole('button', { name: moveFirst(forward.name), exact: true }), 'its Move button, in the new column, holds focus').toBeFocused();
  });

  // -------------------------------------------------------------- AC-6
  test('AC-6 Backing out leaves everything as it was: Cancel, Close and Escape list nothing and return focus to the card\'s Move button', async ({ page }) => {
    const { s, board } = await askFirst(page);
    const { forward } = pickCards(board);
    await showStage(s, forward.from);
    for (const way of [WORDS.cancel, WORDS.close, 'Escape'] as const) {
      const d = await openFromButton(page, s, forward.name, phone() ? 'tap' : 'click');
      await chooseStage(d, forward.to);
      await reason(d).fill('Strong interview');
      if (way === 'Escape') await page.keyboard.press('Escape');
      else {
        const b = d.getByRole('button', { name: way, exact: true });
        if (phone()) await b.tap(); else await b.click();
      }
      await expect(d, `${way} closes the dialog`).toBeHidden();
      expect(await requests(s), `${way} lists no request`).toEqual([]);
      await expectUnmoved(s, board);
      await expect(moveOf(s, forward.name), `${way} returns focus to the card's Move button`).toBeFocused();
    }
    if (phone()) return; // no drag on the phone board

    // After a drop, the card is back where it started.
    for (const way of [WORDS.cancel, 'Escape'] as const) {
      await dragCardTo(page, s, forward.name, forward.to);
      const d = dialog(page, forward.name);
      await expect(d).toBeVisible();
      if (way === 'Escape') await page.keyboard.press('Escape'); else await d.getByRole('button', { name: way, exact: true }).click();
      await expect(d).toBeHidden();
      expect(await requests(s), `after a drop, ${way} lists no request`).toEqual([]);
      await expectUnmoved(s, board);
      await expect(moveOf(s, forward.name), `after a drop, ${way} returns focus to the card's Move button`).toBeFocused();
    }
  });

  // -------------------------------------------------------------- AC-7
  test('AC-7 The dialog says only the approved words, and "Moving back" shows only for an earlier stage', async ({ page }) => {
    const { s, board } = await askFirst(page);
    const { forward, backward } = pickCards(board);
    const stages = board.map((c) => c.stage);
    const base = (name: string) => [moveFirst(name), WORDS.field, WORDS.reason, WORDS.reasonHelp, WORDS.cancel, WORDS.move].sort();

    // From a card with a later stage: the base words; a later stage adds nothing.
    await showStage(s, forward.from);
    let d = await openFromButton(page, s, forward.name, phone() ? 'tap' : 'click');
    await expect(d.getByRole('heading', { name: moveFirst(forward.name), exact: true }), 'the title').toBeVisible();
    await expect(d.getByRole('button', { name: WORDS.close, exact: true }), 'the close button is named "Close"').toBeVisible();
    expect(await stageOptions(d), '"Move to" lists every stage, in stage order').toEqual(stages);
    expect((await visibleBlocks(d)).sort(), 'the dialog shows exactly the approved words').toEqual(base(forward.name));
    await chooseStage(d, forward.to);
    expect((await visibleBlocks(d)).sort(), 'a later stage adds no sentence').toEqual(base(forward.name));
    await reason(d).fill('Strong interview');
    expect((await visibleBlocks(d)).sort(), 'typing a reason adds no sentence').toEqual(base(forward.name));
    await d.getByRole('button', { name: WORDS.cancel, exact: true }).click();
    await expect(d).toBeHidden();

    // From a card with an earlier stage: choosing it adds "Moving back a stage needs a reason too."
    await showStage(s, backward.from);
    d = await openFromButton(page, s, backward.name, phone() ? 'tap' : 'click');
    expect((await visibleBlocks(d)).sort(), 'its own stage adds no sentence').toEqual(base(backward.name));
    await chooseStage(d, backward.to);
    expect((await visibleBlocks(d)).sort(), 'an earlier stage adds the "Moving back" help, and nothing else').toEqual([...base(backward.name), WORDS.backHelp].sort());
    await expect(d.getByText(WORDS.reasonHelp, { exact: true }), 'the saved-with-your-name help stays').toBeVisible();
    const later = stages.indexOf(backward.from) + 1 < stages.length ? stages[stages.indexOf(backward.from) + 1] : null;
    if (later) {
      await chooseStage(d, later);
      expect((await visibleBlocks(d)).sort(), 'a later stage takes the "Moving back" help away again').toEqual(base(backward.name));
    }
  });

  // -------------------------------------------------------------- AC-8
  test('AC-8 The dialog is a proper dialog: modal, named, focus kept inside, every control in view, no axe violation', async ({ page }) => {
    const { s, board } = await askFirst(page);
    const { forward } = pickCards(board);
    await showStage(s, forward.from);
    const d = await openFromButton(page, s, forward.name, phone() ? 'tap' : 'click');
    await expect(d, 'role="dialog" named by its title').toHaveAccessibleName(moveFirst(forward.name));
    await expect(d, 'aria-modal').toHaveAttribute('aria-modal', 'true');
    const inside = () => d.evaluate((el) => el.contains(document.activeElement));
    await expect.poll(inside, 'focus starts inside the dialog').toBe(true);

    await reason(d).fill('Strong interview');
    await chooseStage(d, forward.to); // every control enabled, so Tab has the most stops
    for (const key of ['Tab', 'Shift+Tab'] as const) {
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press(key);
        expect(await inside(), `${key} ${i + 1}: focus stays inside the dialog`).toBe(true);
      }
    }
    // The page behind is inert to the keyboard: no Tab or Shift+Tab above reached it.

    // Every control and button is visible and not under anything (top bar included).
    const controls = [moveTo(d), reason(d), d.getByRole('button', { name: WORDS.close, exact: true }), d.getByRole('button', { name: WORDS.cancel, exact: true }), moveButton(d)];
    for (const c of controls) {
      await c.scrollIntoViewIfNeeded();
      await expect(c).toBeVisible();
      const free = await c.evaluate((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || r.left < 0 || r.top < 0 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) return `outside the window: ${JSON.stringify(r)}`;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit && (el === hit || el.contains(hit) || hit.contains(el) && hit.tagName === 'LABEL') ? 'ok' : `covered by ${hit?.outerHTML.slice(0, 120)}`;
      });
      expect(free, `${await c.evaluate((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName)} is in view and nothing covers it`).toBe('ok');
    }
    // Only the Move dialog: the gallery shows other dialogs in place.
    const only = await d.evaluate((el) => el.id ? `#${CSS.escape(el.id)}` : el.getAttribute('aria-labelledby') ? `[role="dialog"][aria-labelledby="${el.getAttribute('aria-labelledby')}"]` : `[role="dialog"][aria-label="${el.getAttribute('aria-label')}"]`);
    const axe = await new AxeBuilder({ page }).include(only).withTags(AXE_TAGS).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), 'axe finds no violation in the dialog').toEqual([]);
  });

  // ================================================================ Top bar
  // -------------------------------------------------------------- AC-9
  test('AC-9 Off by default: every existing top navigation has no Modules button, and the same controls in the same order as develop', async ({ page }) => {
    await openParity(page);
    const want = PARITY_BARS[project()];
    for (const [name, bars] of Object.entries(want)) {
      const s = page.locator(`[data-parity=${JSON.stringify(name)}]`);
      await expect(s, `/dev/parity still has "${name}"`).toHaveCount(1);
      const got: string[][] = [];
      for (const bar of await s.locator('pp-top-navigation').all()) got.push(await barControls(bar));
      expect(got, `"${name}": the same top bar controls, in the same order, shown and hidden as on develop`).toEqual(bars);
      await expect(s.locator('pp-top-navigation').getByRole('button', { name: WORDS.modules }), `"${name}" has no Modules button`).toHaveCount(0);
      await expect(s.locator('pp-top-navigation').getByText(WORDS.modules), `"${name}" shows no "Modules"`).toHaveCount(0);
    }
  });

  // -------------------------------------------------------------- AC-10
  test('AC-10 Desktop button: "Modules" with the grid icon and the word, left of search, with aria-haspopup and aria-expanded that follows launcherOpen', async ({ page }) => {
    await openParity(page);
    const s = await theSection(page, SECTIONS.launcher);
    const bar = s.locator('pp-top-navigation');
    await expect(bar, 'the section holds one top navigation').toHaveCount(1);
    const b = launcher(bar);
    await expect(b, 'a button named "Modules"').toBeVisible();
    await expect(b, 'type="button"').toHaveAttribute('type', 'button');
    expect(await drawsGrid(b), 'it shows the grid icon (layout-grid)').toBe(true);
    await expect(b, 'aria-haspopup="dialog"').toHaveAttribute('aria-haspopup', 'dialog');
    await expect(b, 'aria-expanded="false" while launcherOpen is off').toHaveAttribute('aria-expanded', 'false');
    const toggle = launcherOpenToggle(s);
    await expect(toggle, 'the section has a launcherOpen toggle').toHaveCount(1);
    await toggle.click();
    await expect(b, 'aria-expanded="true" when launcherOpen is on').toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(b, 'and "false" again when it is off').toHaveAttribute('aria-expanded', 'false');

    if (phone()) return; // at 390 the bar takes the phone layout: the word is hidden by design (AC-11, AC-14)
    expect(await wordShown(b), 'the word "Modules" is visible').toBe(true);
    const search = bar.getByRole('searchbox');
    await expect(search, 'the bar has its search field').toBeVisible();
    const bb = (await b.boundingBox())!;
    const sb = (await bar.locator('.pp-top-navigation__search').boundingBox())!;
    expect(bb.x + bb.width, 'the Modules button sits left of the search field').toBeLessThanOrEqual(sb.x + 0.5);
    const order = await barControls(bar);
    const at = order.findIndex((c) => c.startsWith('button:Modules:'));
    expect(at, 'the Modules button comes before search in the bar').toBeLessThan(order.findIndex((c) => c.startsWith('input:')));
    const collapse = order.findIndex((c) => /^button:(Collapse|Expand) menu:/.test(c));
    if (collapse >= 0) expect(collapse, 'after the collapse button').toBeLessThan(at);
    const visibleBefore = order.slice(0, at).filter((c) => c.endsWith(':shown') && !/^button:(Collapse|Expand) menu:/.test(c));
    expect(visibleBefore, 'nothing visible but the collapse button sits before it: it is at the left end').toEqual([]);
  });

  // -------------------------------------------------------------- AC-11
  test('AC-11 Phone button: icon only, still named "Modules", 44 by 44, in the order menu, Modules, mark, bell, account, nothing overlapping', async ({ page }) => {
    // The phone section is compact, so it is the phone bar at either width; the card asks for 390, and 1280 checks compact.
    await openParity(page);
    const s = await theSection(page, SECTIONS.launcherPhone);
    const bar = s.locator('pp-top-navigation');
    await expect(bar).toHaveCount(1);
    const b = launcher(bar);
    await expect(b, 'the button is still named "Modules"').toBeVisible();
    expect(await wordShown(b), 'the word "Modules" is not visible').toBe(false);
    expect(await drawsGrid(b), 'the grid icon shows').toBe(true);
    const box = (await b.boundingBox())!;
    expect(box.width, 'at least 44 wide').toBeGreaterThanOrEqual(44);
    expect(box.height, 'at least 44 high').toBeGreaterThanOrEqual(44);

    const named = [
      bar.getByRole('button', { name: 'Open menu', exact: true }),
      b,
      bar.getByRole('link', { name: 'Naleko People home', exact: true }),
      bar.getByRole('button', { name: /^Notifications/ }),
      bar.getByRole('button', { name: /^Your account/ }),
    ];
    const boxes = [];
    for (const n of named) {
      await expect(n, 'every one is visible').toBeVisible();
      boxes.push((await n.boundingBox())!);
    }
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].x, 'left to right: menu, Modules, mark, then bell and account').toBeGreaterThan(boxes[i - 1].x);
    const all = await bar.evaluate((root) => [...root.querySelectorAll('button, a[href], input')]
      .filter((e) => (e as HTMLElement).checkVisibility({ visibilityProperty: true }))
      .map((e) => { const r = e.getBoundingClientRect(); return { name: e.getAttribute('aria-label') ?? e.textContent?.trim(), l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
    const overlaps: string[] = [];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const p = all[i], q = all[j];
      if (Math.min(p.r, q.r) - Math.max(p.l, q.l) > 0.5 && Math.min(p.b, q.b) - Math.max(p.t, q.t) > 0.5) overlaps.push(`${p.name} / ${q.name}`);
    }
    expect(overlaps, 'no control overlaps another').toEqual([]);
    // The gallery page as a whole already scrolls sideways at 390 on develop (other cards' sections, and the existing
    // "Phone (compact)" frame by 2px), so the check is that the bar adds none: nothing in it is wider than the bar,
    // no control ends past the bar, and the bar ends inside the window.
    const wide = await bar.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const past = [...el.querySelectorAll('button, a[href], input')].filter((e) => (e as HTMLElement).checkVisibility()).map((e) => e.getBoundingClientRect().right - r.right).filter((d) => d > 0.5);
      return { inside: el.scrollWidth - el.clientWidth, controlsPast: past.length, window: r.right - document.documentElement.clientWidth <= 0.5 };
    });
    expect(wide, 'no horizontal scroll from the bar: it fits its own width and ends inside the window').toEqual({ inside: 0, controlsPast: 0, window: true });
  });

  // -------------------------------------------------------------- AC-12
  test('AC-12 It emits on click, Enter and Space, and it is in the Tab order before search (desktop) and after the menu button (phone)', async ({ page }) => {
    await openParity(page);
    for (const name of [SECTIONS.launcher, SECTIONS.launcherPhone]) {
      const s = await theSection(page, name);
      const b = launcher(s.locator('pp-top-navigation'));
      await expect(b, `"${name}" has the Modules button`).toBeVisible();
      const start = await launcherClicks(s);
      if (phone()) await b.tap(); else await b.click();
      await expect.poll(() => launcherClicks(s), `"${name}": a ${phone() ? 'tap' : 'click'} adds one`).toBe(start + 1);
      await b.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => launcherClicks(s), `"${name}": Enter adds one`).toBe(start + 2);
      await b.focus();
      await page.keyboard.press('Space');
      await expect.poll(() => launcherClicks(s), `"${name}": Space adds one`).toBe(start + 3);
    }

    const focused = () => page.evaluate(() => { const e = document.activeElement as HTMLElement | null; return e ? (e.getAttribute('aria-label') ?? e.textContent?.trim() ?? '') : ''; });
    if (!phone()) {
      const bar = (await theSection(page, SECTIONS.launcher)).locator('pp-top-navigation');
      await launcher(bar).focus();
      await page.keyboard.press('Tab');
      await expect(bar.getByRole('searchbox'), 'desktop: Tab from Modules goes to search').toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(launcher(bar), 'and Shift+Tab from search comes back to Modules').toBeFocused();
    } else {
      const bar = (await theSection(page, SECTIONS.launcherPhone)).locator('pp-top-navigation');
      const menu = bar.getByRole('button', { name: 'Open menu', exact: true });
      await menu.focus();
      await page.keyboard.press('Tab');
      await expect(launcher(bar), `phone: Tab from the menu button goes to Modules (focus is on "${await focused()}")`).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(menu, 'and Shift+Tab from Modules goes back to the menu button').toBeFocused();
    }
  });

  // -------------------------------------------------------------- AC-13
  test('AC-13 No axe violations on either top bar section', async ({ page }) => {
    await openParity(page);
    for (const name of [SECTIONS.launcher, SECTIONS.launcherPhone]) {
      const s = await theSection(page, name);
      await expect(launcher(s.locator('pp-top-navigation')), `"${name}" has the Modules button`).toBeVisible();
      const axe = await new AxeBuilder({ page }).include(`[data-parity$=${JSON.stringify('|' + name)}]`).withTags(AXE_TAGS).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `axe finds no violation in "${name}"`).toEqual([]);
    }
  });

  // ================================================================ Design system
  // -------------------------------------------------------------- AC-14
  test('AC-14 One source: sync.json is pinned and matches the synced files, the synced CSS hides the launcher word on phones and in compact, verify:design passes', async ({ page, browser }) => {
    once('reads the repository and runs verify:design once; it opens its own 1280 and 390 windows');
    test.setTimeout(3 * 60_000);
    const manifest = JSON.parse(readFileSync(join(DS_DIR, 'sync.json'), 'utf8')) as { repo: string; ref: string; files: Record<string, string> };
    expect(manifest.repo, 'synced from the design system repo').toBe('obsydian-tech/pepla-design-system');
    expect(manifest.ref, 'the ref is a full commit (40 hex), not a branch, a tag or a local sync').toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(manifest.files), 'sync.json lists components.css').toContain('components.css');
    for (const [file, hash] of Object.entries(manifest.files)) expect(sha256(readFileSync(join(DS_DIR, file))), `${file} is the synced file (hash matches sync.json)`).toBe(hash);

    // The Modules button as the app renders it, put into a page that has nothing but the synced design system CSS.
    await openParity(page);
    const s = await theSection(page, SECTIONS.launcher);
    const b = launcher(s.locator('pp-top-navigation'));
    await expect(b, 'the gallery has the Modules button').toBeVisible();
    const button = await b.evaluate((el) => el.outerHTML);
    const order = ['tokens/palette.css', 'tokens/colors.css', 'tokens/typography.css', 'tokens/spacing.css', 'tokens/shape.css', 'tokens/motion.css', 'tokens/layers.css', 'tokens/base.css', 'components.css'];
    const css = order.map((f) => readFileSync(join(DS_DIR, f), 'utf8')).join('\n').replace(/url\((['"]?)\.\.?\/?assets\/[^)]*\)/g, 'none');
    const html = (compact: boolean) => `<!doctype html><html><head><style>${css}</style></head><body>
      <header class="pp-top-navigation pp-top-navigation--inline${compact ? ' pp-top-navigation--compact' : ''}">${button}
        <label class="pp-top-navigation__search"><input class="pp-top-navigation__search-input" type="search" aria-label="Search people and documents"></label>
        <div class="pp-top-navigation__actions"></div></header></body></html>`;
    for (const [width, compact, shown, why] of [
      [1280, false, true, 'desktop shows the word'],
      [390, false, false, 'the phone breakpoint hides the word'],
      [1280, true, false, 'the compact bar hides the word'],
    ] as const) {
      const ctx = await browser.newContext({ viewport: { width, height: 800 } });
      try {
        const p = await ctx.newPage();
        await p.setContent(html(compact));
        const lone = p.getByRole('button', { name: WORDS.modules, exact: true });
        await expect(lone).toBeVisible();
        expect(await wordShown(lone), `synced components.css alone: ${why} (${width} wide${compact ? ', compact' : ''})`).toBe(shown);
      } finally {
        await ctx.close();
      }
    }

    let out = '';
    let ok = true;
    try {
      out = execFileSync('npm', ['run', 'verify:design'], { cwd: PEPLA_WEB, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
    } catch (e) {
      ok = false;
      const err = e as { stdout?: string; stderr?: string };
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    expect(ok, `npm run verify:design passes:\n${out.slice(-2000)}`).toBe(true);
  });

  // -------------------------------------------------------------- AC-16
  test('AC-16 The sync is on the design system main that holds the Modules button: not develop\'s older sync, files match their hashes', async () => {
    // Amended in ang-01.2 (17 Nov): the phone tab, page header and stacked table rules come with design system #48, which sits
    // behind #47 (site kit change). The landing tests (SITE-03, SITE-04) are locked to the older site kit, so those rules wait
    // for the card that moves the landing to the new site kits. This test keeps the part that holds today.
    const manifest = JSON.parse(readFileSync(join(DS_DIR, 'sync.json'), 'utf8')) as { ref: string; files: Record<string, string> };
    expect(manifest.ref, 'the ref is a full commit (40 hex)').toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.ref.startsWith('1cee4a5'), 'the ref is not develop\'s older sync (1cee4a5)').toBe(false);
    for (const [file, hash] of Object.entries(manifest.files)) {
      expect(sha256(readFileSync(join(DS_DIR, file))), `${file} is the synced file`).toBe(hash);
    }
  });

  // -------------------------------------------------------------- AC-15
  test('AC-15 Nothing else moved: only the card\'s files change, and the HR and employee top bars are as they were', async ({ page, signIn, hr, employee }) => {
    test.setTimeout(2 * 60_000);
    if (!phone()) {
      let base = '';
      for (const ref of ['origin/develop', 'develop']) { try { base = git('merge-base', 'HEAD', ref); break; } catch { /* next */ } }
      // CI checks out the pull request's merge commit with no develop branch: its first parent is develop's tip.
      if (!base && process.env['GITHUB_ACTIONS'] === 'true') {
        try { git('rev-parse', '--verify', '-q', 'HEAD^1'); } catch { git('fetch', '--no-tags', '--quiet', '--depth=2', 'origin', process.env['GITHUB_SHA'] ?? git('rev-parse', 'HEAD')); }
        try { base = git('rev-parse', 'HEAD^1'); } catch { /* stays empty */ }
      }
      expect(base, 'develop is known (git merge-base HEAD origin/develop)').not.toBe('');
      const changed = git('diff', '--name-only', '--no-renames', base, 'HEAD', '--', '.').split('\n').filter(Boolean).map((f) => f.replace(/^pepla-web\//, ''));
      // Judged on a pull request that carries this card's tests (the lock and the build); another card's PR is not.
      if (changed.some((f) => /^e2e\/acceptance\/(ang-01\.spec\.ts|support\/ang-01\/|cards\/ang-01\.md)/.test(f))) {
        const allowed = (f: string) =>
          /^e2e\/acceptance\/(ang-01\.spec\.ts|cards\/ang-01\.md)$/.test(f) ||
          /^e2e\/acceptance\/support\/ang-01\//.test(f) ||
          /^src\/app\/ds\/records\/pipeline\.ts$/.test(f) ||
          /^src\/app\/ds\/navigation\/shell\.ts$/.test(f) ||
          /^src\/app\/dev\/(parity|design-system)\.page\.(ts|html)$/.test(f) ||
          /^src\/app\/ds\/README\.md$/.test(f) ||
          /^src\/styles\/design-system\//.test(f);
        expect(changed.filter((f) => !allowed(f)), 'no file outside the card\'s list changes').toEqual([]);
      }
    }

    // The HR and employee pages keep their bars: no Modules button, the same controls as develop.
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(/\/hr$/, { timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('pp-top-navigation'), 'HR has one top bar').toHaveCount(1);
    expect(await barControls(page.locator('pp-top-navigation')), 'HR\'s top bar is as on develop, with no Modules button').toEqual(HR_BAR[project()]);
    await forgetSignIn(page);
    await signIn.open();
    await signIn.signInAs(employee);
    await expect(page).toHaveURL(/\/start/, { timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('pp-top-navigation'), 'the employee has one top bar').toHaveCount(1);
    expect(await barControls(page.locator('pp-top-navigation')), 'the employee\'s top bar is as on develop, with no Modules button').toEqual(EMPLOYEE_BAR[project()]);
  });
});
