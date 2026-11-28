import type { Locator, Page } from '@playwright/test';
import { ON_DEV, type SignInPage } from './support/fixtures';
import type { CognitoFake } from './support/cognito-fake';
import type { ModulesFake } from './support/mod-02/modules-fake';
import { WHO, enter, quiet, test, type HireFake } from './support/rec-ui/harness';
import { A_ALL, W, expect, names } from './support/rec-ui-02/lists';

/**
 * REC-UI-02 board hint · Say why Board is greyed out on the Pipeline list (Jira NH-313, parent NH-223, amber).
 * Child lock acceptance-lock/rec-ui-02.10. Spec: onboarding-cards/specs/REC-UI-02-board-hint.md (rules 1 to 6, AC-BH1 to
 * AC-BH6), its checks REC-UI-02-board-hint-SPEC-CHECK-R1.md (F-1 to F-6) and -R2.md (pass, E-1, E-2). Words: Iggie's own,
 * approved 28 Nov 2026 16:44 SAST (D-RUI-02.38), full stop included. Where the spec is silent, cards/rec-ui-02.10.md says
 * what these tests take (T-BH1 to T-BH8).
 *
 * Board stays greyed while no role is chosen (D-RUI-2, locked by rec-ui-02.spec.ts AC-1); only the reason is added.
 * Desktop: the design system tooltip on Board. Phone (390): one small visible line under the List | Board switch.
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg.
 * The AC-BH1 and AC-BH4 @pepla-dev tests run on pepla-dev only. No test calls Bedrock or any paid AI.
 */

/** Iggie's words, exactly (D-RUI-02.38). */
const LINE = 'Choose one role to see its board.';

const phone = () => test.info().project.name === 'phone-390';
const desktopOnly = (why: string) => test.skip(phone(), `Desktop only: ${why}`);
const phoneOnly = (why: string) => test.skip(!phone(), `Phone only: ${why}`);
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');

type Fx = { page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null };

const main = (page: Page): Locator => page.locator('main');
const h1 = (page: Page): Locator => page.locator('main h1').first();
const header = (page: Page): Locator => main(page).locator('.pp-page-header').first();
const view = (page: Page, name: 'List' | 'Board'): Locator => main(page).getByRole('button', { name, exact: true });
const addButton = (page: Page): Locator => main(page).getByRole('button', { name: 'Add candidate', exact: true });
/** The tooltip while it shows (pp-tooltip's floating copy). The always-there description has no role. */
const shownTip = (page: Page): Locator => page.locator('[role="tooltip"]').filter({ hasText: LINE });

async function asRecruiter(fx: Fx): Promise<void> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, WHO.recruiterA);
}

/** Opens a Pipeline address and waits for the list header (every address here shows the Pipeline list). */
async function openAt(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(h1(page)).toHaveText(W.pipeline);
  await quiet(page);
}

/**
 * Every copy of the words in the whole page: each element whose own text holds them, and each attribute value that holds
 * them (a title or aria-label copy would be read twice). T-BH1: exactly one copy, and that copy is the line and nothing else.
 */
async function copies(page: Page): Promise<string[]> {
  return page.evaluate((line) => {
    const out: string[] = [];
    for (const el of [document.documentElement, ...document.documentElement.querySelectorAll('*')]) {
      const own = [...el.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.textContent ?? '').join('').replace(/\s+/g, ' ').trim();
      if (own.includes(line)) out.push(own);
      for (const a of [...el.attributes]) if (a.value.includes(line)) out.push(`${a.name}=${a.value}`);
    }
    return out;
  }, LINE);
}

async function boxOf(l: Locator): Promise<{ x: number; y: number; w: number; h: number }> {
  const b = await l.boundingBox();
  expect(b, 'has a box').not.toBeNull();
  return { x: b!.x, y: b!.y, w: b!.width, h: b!.height };
}

/** Pressing Board (pointer, forced past its greyed look) leaves the list where it is: no board, same address (rule 2). */
async function boardDoesNothing(page: Page): Promise<void> {
  const before = page.url();
  await view(page, 'Board').click({ force: true });
  await quiet(page);
  expect(page.url(), 'Board changes nothing while no role is chosen').toBe(before);
  await expect(main(page).locator('.pp-pipeline'), 'no board').toHaveCount(0);
  await expect(h1(page)).toHaveText(W.pipeline);
}

/** Tab from List until focus is on Board; fails when Tab never gets there (a `disabled` Board is skipped by Tab). */
async function tabToBoard(page: Page): Promise<void> {
  await view(page, 'List').focus();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Tab');
    if (await view(page, 'Board').evaluate((b) => b === document.activeElement)) return;
  }
  throw new Error('Tab from List never reached Board (rule 2: Board must stay reachable by Tab)');
}

/** In-page times (performance.now) of the pointer entering Board, the last key press, and the tooltip first showing. */
async function watchTip(page: Page): Promise<void> {
  await view(page, 'Board').evaluate((board, line) => {
    const w = window as unknown as { __bh: { enter: number; key: number; shown: number } };
    w.__bh = { enter: 0, key: 0, shown: 0 };
    board.addEventListener('mouseenter', () => { w.__bh.enter = performance.now(); });
    document.addEventListener('keydown', () => { w.__bh.key = performance.now(); w.__bh.shown = 0; }, true);
    const seen = () => [...document.querySelectorAll('[role="tooltip"]')].some((t) => (t.textContent ?? '').includes(line));
    new MutationObserver(() => { if (seen()) { if (!w.__bh.shown) w.__bh.shown = performance.now(); } else w.__bh.shown = 0; })
      .observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
  }, LINE);
}
const times = (page: Page) => page.evaluate(() => (window as unknown as { __bh: { enter: number; key: number; shown: number } }).__bh);

// ================================================================ AC-BH1 The words are Board's description (rules 1 to 4)
test.describe('AC-BH1 Board hint with All roles', () => {
  test.beforeEach(noBackendOnly);

  test(`AC-BH1 With All roles chosen, Board's description is exactly "${LINE}", Board is still disabled (aria-disabled, no disabled attribute), the words are in the page once, and Board still does nothing`, async ({ page, signIn, cognito, modules, hire }) => {
    await asRecruiter({ page, signIn, cognito, modules, hire });
    await openAt(page, '/hire/pipeline');
    const board = view(page, 'Board');
    await expect(board).toHaveCount(1);
    await expect(board).toHaveAccessibleDescription(LINE);
    await expect(board, 'still greyed (D-RUI-2)').toBeDisabled();
    await expect(board, 'greyed by aria-disabled (rule 2, F-1)').toHaveAttribute('aria-disabled', 'true');
    expect(await board.evaluate((b) => b.hasAttribute('disabled')), 'no disabled attribute, so Tab reaches it (rule 2, F-1)').toBe(false);
    await expect(shownTip(page), 'the tooltip is closed before anyone points at Board').toHaveCount(0);
    expect(await copies(page), 'with the tooltip closed, one copy of the words, and nothing else in it').toEqual([LINE]);
    await expect(view(page, 'List')).toHaveAttribute('aria-pressed', 'true');
    await boardDoesNothing(page);
    await expect(board).toHaveAccessibleDescription(LINE);
  });
});

// ================================================================ AC-BH2 Desktop tooltip (rule 3)
test.describe('AC-BH2 Desktop tooltip', () => {
  test.beforeEach(noBackendOnly);

  test(`AC-BH2 Desktop: hovering Board shows the tooltip "${LINE}" after the delay and moving away hides it; Tab to Board shows it at once, Escape hides it and focus stays on Board`, async ({ page, signIn, cognito, modules, hire }) => {
    desktopOnly('the phone has no hover, and the phone shows a visible line instead (rule 4)');
    await asRecruiter({ page, signIn, cognito, modules, hire });
    await openAt(page, '/hire/pipeline');
    await watchTip(page);
    await expect(shownTip(page)).toHaveCount(0);

    // Hover: shows after the tooltip's delay (in-page times, so a slow test machine cannot make it pass or fail).
    await view(page, 'Board').hover();
    await expect(shownTip(page)).toBeVisible();
    await expect(shownTip(page)).toHaveText(LINE);
    const hovered = await times(page);
    expect(hovered.enter, 'the pointer entered Board').toBeGreaterThan(0);
    expect(hovered.shown - hovered.enter, 'shown after the hover delay, not at once (tooltip.md: 300 ms)').toBeGreaterThanOrEqual(200);
    const tip = await boxOf(shownTip(page));
    const b = await boxOf(view(page, 'Board'));
    expect(tip.w, 'the tooltip has room for its words').toBeGreaterThan(40);
    expect(tip.y + tip.h <= b.y + 1 || tip.y >= b.y + b.h - 1, 'the tooltip sits above or below Board, not over it').toBe(true);
    await h1(page).hover();
    await expect(shownTip(page), 'moving away hides it').toHaveCount(0);
    await page.mouse.move(1, 790);

    // Keyboard: Tab reaches Board, the tooltip shows at once, Escape hides it and focus stays.
    await tabToBoard(page);
    await expect(shownTip(page)).toBeVisible();
    await expect(shownTip(page)).toHaveText(LINE);
    const keyed = await times(page);
    expect(keyed.shown - keyed.key, 'shown at once on keyboard focus, not after the hover delay').toBeLessThan(250);
    await expect(view(page, 'Board')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(shownTip(page), 'Escape hides it').toHaveCount(0);
    await expect(view(page, 'Board'), 'focus stays on Board after Escape').toBeFocused();
    await expect(view(page, 'Board')).toHaveAccessibleDescription(LINE);
    expect(await copies(page), 'the description is still there once, after Escape').toEqual([LINE]);

    // Enter and Space on the greyed Board do nothing (rule 2: board() still needs a role).
    const before = page.url();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await quiet(page);
    expect(page.url()).toBe(before);
    await expect(main(page).locator('.pp-pipeline')).toHaveCount(0);
    await expect(h1(page)).toHaveText(W.pipeline);
  });

  test('AC-BH2 Desktop: there is no visible line under the switch, only the tooltip (rule 3, one copy per width)', async ({ page, signIn, cognito, modules, hire }) => {
    desktopOnly('the phone shows the visible line (rule 4)');
    await asRecruiter({ page, signIn, cognito, modules, hire });
    await openAt(page, '/hire/pipeline');
    const visibleCopies = await page.evaluate((line) => [...document.querySelectorAll('body *')].filter((el) => {
      const own = [...el.childNodes].filter((c) => c.nodeType === Node.TEXT_NODE).map((c) => c.textContent ?? '').join('').trim();
      if (!own.includes(line)) return false;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.opacity !== '0' && s.display !== 'none';
    }).length, LINE);
    expect(visibleCopies, 'nothing shows the words until Board is pointed at or focused').toBe(0);
    await expect(view(page, 'Board'), 'Board sits inside the design system tooltip (rule 3)').toHaveCount(1);
    expect(await view(page, 'Board').evaluate((b) => !!b.closest('pp-tooltip')), 'Board is inside pp-tooltip').toBe(true);
  });
});

// ================================================================ AC-BH3 Phone line (rule 4)
test.describe('AC-BH3 Phone line', () => {
  test.beforeEach(noBackendOnly);

  test(`AC-BH3 At 390 "${LINE}" is visible under the List | Board switch, small subtle text, fully on screen, not under the top bar, no sideways scroll; Board points at it and has no tooltip`, async ({ page, signIn, cognito, modules, hire }) => {
    phoneOnly('the desktop shows the tooltip instead (rule 3)');
    await asRecruiter({ page, signIn, cognito, modules, hire });
    await openAt(page, '/hire/pipeline');
    const line = main(page).getByText(LINE, { exact: true });
    await expect(line).toHaveCount(1);
    await expect(line).toBeVisible();
    await expect(line).toHaveText(LINE);
    expect(await line.evaluate((el) => [...el.classList].sort()), 'the design system small subtle text (rule 4)').toEqual(expect.arrayContaining(['pp-text', 'pp-text--small', 'pp-text--subtle']));
    const id = await line.getAttribute('id');
    expect(id, 'the line has an id').toBeTruthy();
    expect((await view(page, 'Board').getAttribute('aria-describedby'))?.split(/\s+/), 'Board points at the line').toContain(id);
    await expect(view(page, 'Board')).toHaveAccessibleDescription(LINE);
    expect(await view(page, 'Board').evaluate((b) => !!b.closest('pp-tooltip')), 'no pp-tooltip on phone (rule 4)').toBe(false);

    // One wrapper (pp-stack with a gap) inside the header actions holds the switch and the line; Add candidate stays outside.
    const shape = await line.evaluate((el) => {
      const board = [...el.closest('main')!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Board');
      const group = board?.closest('.pp-button-group');
      const wrap = el.parentElement!;
      return {
        wrapIsStack: wrap.classList.contains('pp-stack') && [...wrap.classList].some((c) => c.startsWith('pp-gap-')),
        wrapInActions: wrap.parentElement?.classList.contains('pp-page-header__actions') ?? false,
        groupInWrap: !!group && wrap.contains(group) && group.parentElement === wrap,
      };
    });
    expect(shape, 'switch and line in one pp-stack inside .pp-page-header__actions').toEqual({ wrapIsStack: true, wrapInActions: true, groupInWrap: true });

    // Under the switch, on screen, not under the top bar, nothing covering it, no sideways scroll.
    await page.evaluate(() => window.scrollTo(0, 0));
    const l = await boxOf(line);
    const g = await view(page, 'Board').evaluate((b) => { const r = b.closest('.pp-button-group')!.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const width = page.viewportSize()!.width;
    expect(l.y, 'under the switch').toBeGreaterThanOrEqual(g.y + g.h - 1);
    expect(l.x, 'not cut off on the left').toBeGreaterThanOrEqual(0);
    expect(l.x + l.w, 'not cut off on the right').toBeLessThanOrEqual(width);
    expect(l.h, 'has height').toBeGreaterThan(0);
    const problems = await line.evaluate((el) => {
      const out: string[] = [];
      const r = el.getBoundingClientRect();
      const bar = document.querySelector('pp-top-navigation')?.getBoundingClientRect();
      if (bar && r.top < bar.bottom - 1) out.push('under the top bar');
      if (r.bottom > innerHeight) out.push('below the first screen');
      const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 20), r.top + r.height / 2);
      if (hit && !el.contains(hit)) out.push(`covered by ${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}`);
      const range = document.createRange(); range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      if (t.right > r.right + 1 || t.bottom > r.bottom + 1) out.push('its words spill out of it');
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide)`);
      return out;
    });
    expect(problems).toEqual([]);
  });
});

// ================================================================ AC-BH4 One role chosen: no hint (rule 1, rule 2)
test.describe('AC-BH4 One role chosen', () => {
  test.beforeEach(noBackendOnly);

  {
    const path = '/hire/pipeline?role=role-fleet&view=list';
    test(`AC-BH4 At ${path} the words are nowhere in the page, Board is enabled and has no aria-disabled and no description`, async ({ page, signIn, cognito, modules, hire }) => {
      await asRecruiter({ page, signIn, cognito, modules, hire });
      await openAt(page, path);
      await expect.poll(() => names(page)).toEqual(['Bongani Mthembu', 'Tendai Ncube', 'Amahle Dlamini', 'Tariro Moyo', 'Ayanda Mkhize', 'Kagiso Molefe']);
      await expect(view(page, 'Board')).toBeEnabled();
      expect(await view(page, 'Board').evaluate((b) => b.hasAttribute('aria-disabled')), 'no aria-disabled at all, not "false" (rule 2)').toBe(false);
      await expect(view(page, 'Board')).toHaveAccessibleDescription('');
      expect(await copies(page), 'the words are nowhere').toEqual([]);
      if (!phone()) {
        await view(page, 'Board').hover();
        await page.waitForTimeout(700);
        await expect(shownTip(page), 'no tooltip with the words on an enabled Board').toHaveCount(0);
        expect(await copies(page)).toEqual([]);
      }
    });
  }

  test('AC-BH4 Choosing a role takes the hint away and turns Board on; going back to All roles brings it back; the board page has no hint', async ({ page, signIn, cognito, modules, hire }) => {
    await asRecruiter({ page, signIn, cognito, modules, hire });
    await openAt(page, '/hire/pipeline');
    await expect(view(page, 'Board')).toHaveAccessibleDescription(LINE);
    const role = main(page).getByLabel('Role', { exact: true });
    const pick = async (label: string) => {
      if ((await role.evaluate((el) => el.tagName)) === 'SELECT') await role.selectOption({ label });
      else { await role.click(); await page.getByRole('option', { name: label, exact: true }).click(); }
      await quiet(page);
    };
    await pick('Fleet controller');
    await expect(view(page, 'Board')).toBeEnabled();
    expect(await view(page, 'Board').evaluate((b) => b.hasAttribute('aria-disabled')), 'no aria-disabled once a role is chosen').toBe(false);
    await expect(view(page, 'Board')).toHaveAccessibleDescription('');
    expect(await copies(page), 'gone with one role chosen').toEqual([]);
    await pick(W.allRoles);
    await expect(view(page, 'Board')).toBeDisabled();
    await expect(view(page, 'Board')).toHaveAccessibleDescription(LINE);
    expect(await copies(page), 'back, once').toEqual([LINE]);
    await pick('Fleet controller');
    await view(page, 'Board').click();
    await expect(page).toHaveURL(/view=board/);
    await expect(h1(page)).toHaveText('Fleet controller');
    await quiet(page);
    await expect(view(page, 'Board')).toBeEnabled();
    expect(await copies(page), 'the board page has no hint').toEqual([]);
    await page.goto('/hire/pipeline?role=role-fleet');
    await expect(h1(page)).toHaveText('Fleet controller');
    await quiet(page);
    await expect(main(page).locator('.pp-pipeline').first()).toBeVisible();
    expect(await copies(page), 'the board address with one role has no hint').toEqual([]);
  });
});

// ================================================================ AC-BH5 The board address with All roles (rule 1)
test.describe('AC-BH5 All roles addresses', () => {
  test.beforeEach(noBackendOnly);

  for (const path of ['/hire/pipeline?role=all&view=board', '/hire/pipeline?role=all', '/hire/pipeline?role=all&view=list']) {
    test(`AC-BH5 ${path} shows the list with the hint: Board disabled, its description the words, once`, async ({ page, signIn, cognito, modules, hire }) => {
      await asRecruiter({ page, signIn, cognito, modules, hire });
      await openAt(page, path);
      await expect(main(page).locator('.pp-pipeline')).toHaveCount(0);
      await expect.poll(() => names(page)).toEqual(A_ALL.map((r) => r.name));
      await expect(view(page, 'Board')).toBeDisabled();
      await expect(view(page, 'Board')).toHaveAttribute('aria-disabled', 'true');
      await expect(view(page, 'Board')).toHaveAccessibleDescription(LINE);
      expect(await copies(page)).toEqual([LINE]);
      if (phone()) await expect(main(page).getByText(LINE, { exact: true })).toBeVisible();
    });
  }
});

// ================================================================ AC-BH6 Nothing else moves (rule 5)
test.describe('AC-BH6 Nothing else moves', () => {
  test.beforeEach(noBackendOnly);

  test('AC-BH6 The heading and "{n} candidates" are unchanged and List stays pressed; desktop: Add candidate, List and Board share one height and vertical centre and the header is no taller than with a role; phone: Add candidate is a direct part of the header actions, at least 48 px, on screen', async ({ page, signIn, cognito, modules, hire }) => {
    hire!.countsOverride = { all: 40, mine: 5, overdue: 2, due_soon: 3, not_hired: 4 };
    await asRecruiter({ page, signIn, cognito, modules, hire });

    // Without the hint: one role chosen (same header, same buttons).
    await openAt(page, '/hire/pipeline?role=role-fleet&view=list');
    await expect(view(page, 'Board')).toBeEnabled();
    const plain = await boxOf(header(page));

    await openAt(page, '/hire/pipeline');
    await expect(view(page, 'Board')).toHaveAccessibleDescription(LINE);
    await expect(h1(page)).toHaveText(W.pipeline);
    await expect(main(page).locator('.pp-page-header__description').first()).toHaveText('40 candidates');
    await expect(view(page, 'List')).toHaveAttribute('aria-pressed', 'true');
    await expect(addButton(page)).toHaveCount(1);
    expect(await addButton(page).evaluate((b) => !!b.parentElement?.classList.contains('pp-page-header__actions')), 'Add candidate is a direct child of .pp-page-header__actions').toBe(true);
    await expect(header(page).locator('.pp-page-header__actions'), 'the actions are in the page header').toHaveCount(1);

    const add = await boxOf(addButton(page));
    const width = page.viewportSize()!.width;
    if (phone()) {
      expect(add.h, 'the design system\'s large control on phone (A-6)').toBeGreaterThanOrEqual(48);
      expect(add.x, 'on the screen').toBeGreaterThanOrEqual(0);
      expect(add.x + add.w, 'on the screen').toBeLessThanOrEqual(width);
      return;
    }
    for (const name of ['List', 'Board'] as const) {
      const s = await boxOf(view(page, name));
      expect(Math.abs(add.h - s.h), `${name}: the same height as Add candidate`).toBeLessThanOrEqual(1);
      expect(Math.abs(add.y + add.h / 2 - (s.y + s.h / 2)), `${name}: the same vertical centre as Add candidate`).toBeLessThanOrEqual(1);
    }
    const withHint = await boxOf(header(page));
    expect(withHint.h, 'the header is no taller with the hint').toBeLessThanOrEqual(plain.h + 1);
    const list = await boxOf(view(page, 'List'));
    const board = await boxOf(view(page, 'Board'));
    expect(board.x, 'Board stays right of List').toBeGreaterThan(list.x);
    expect(add.x, 'Add candidate stays after the switch').toBeGreaterThan(board.x);
  });
});

// ================================================================ pepla-dev: AC-BH1 and AC-BH4 (spec "Dev check after merge")
test.describe('AC-BH pepla-dev', () => {
  test.skip(!ON_DEV, 'Runs on pepla-dev only.');

  test(`AC-BH1 AC-BH4 @pepla-dev The HR login sees "${LINE}" as Board's description with All roles, once, Board greyed; with one role chosen the words are gone and Board is on`, async ({ page, signIn, hr }) => {
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await openAt(page, '/hire/pipeline');
    await expect(view(page, 'Board')).toBeDisabled();
    await expect(view(page, 'Board')).toHaveAttribute('aria-disabled', 'true');
    await expect(view(page, 'Board')).toHaveAccessibleDescription(LINE);
    expect(await copies(page)).toEqual([LINE]);
    if (phone()) await expect(main(page).getByText(LINE, { exact: true })).toBeVisible();
    const role = main(page).getByLabel('Role', { exact: true });
    if ((await role.evaluate((el) => el.tagName)) === 'SELECT') {
      const first = (await role.locator('option').allTextContents()).map((t) => t.trim()).find((t) => t !== W.allRoles);
      expect(first, 'the HR login has at least one role').toBeTruthy();
      await role.selectOption({ label: first! });
    } else {
      await role.click();
      const opts = page.getByRole('option').filter({ hasNotText: W.allRoles });
      expect(await opts.count(), 'the HR login has at least one role').toBeGreaterThan(0);
      await opts.first().click();
    }
    await quiet(page);
    await expect(view(page, 'Board')).toBeEnabled();
    expect(await view(page, 'Board').evaluate((b) => b.hasAttribute('aria-disabled'))).toBe(false);
    await expect(view(page, 'Board')).toHaveAccessibleDescription('');
    expect(await copies(page)).toEqual([]);
  });
});
