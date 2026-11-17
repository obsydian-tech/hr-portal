import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { LayoutGrid } from 'lucide';
import { expect } from '../fixtures';

/**
 * ANG-01 helpers: the /dev/parity gallery sections the card names, the pipeline board read from the page,
 * the Move dialog, the dev-only hooks, and the top navigation's controls.
 * Spec: /mnt/project-files/onboarding-cards/specs/ANG-01.md (NH-233). Notes: ../../cards/ang-01.md.
 */

export const PEPLA_WEB = join(__dirname, '..', '..', '..', '..');
export const DS_DIR = join(PEPLA_WEB, 'src', 'styles', 'design-system');
export const PARITY = '/dev/parity';

// ---------------------------------------------------------------- the card's words (all approved; nothing new)
export const WORDS = {
  field: 'Move to',
  reason: 'Why? (required)',
  reasonHelp: 'Saved with your name and the time.',
  backHelp: 'Moving back a stage needs a reason too.',
  cancel: 'Cancel',
  move: 'Move',
  close: 'Close',
  modules: 'Modules',
  empty: 'No one yet',
} as const;
/** Dialog title and the card's Move button name in ask-first mode: "Move {first name}". */
export const moveFirst = (fullName: string) => `Move ${firstName(fullName)}`;
/** Today's Move button name. */
export const moveToday = (fullName: string) => `Move ${fullName} to another stage`;
/** First name = the text before the first space of the candidate's name. */
export const firstName = (fullName: string) => fullName.split(' ')[0];

// ---------------------------------------------------------------- gallery sections, by data-parity name
/** The section on /dev/parity whose data-parity name is "<component slug>|<name>". */
export function section(page: Page, name: string): Locator {
  return page.locator(`[data-parity$=${JSON.stringify('|' + name)}]`);
}

export async function openParity(page: Page): Promise<void> {
  await page.goto(PARITY);
  await expect(page.locator('[data-parity]').first(), '/dev/parity shows its sections').toBeAttached({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}

/** The one section with this name; fails with the name when the gallery does not have it. */
export async function theSection(page: Page, name: string): Promise<Locator> {
  const s = section(page, name);
  await expect(s, `/dev/parity has exactly one section named "${name}"`).toHaveCount(1);
  return s;
}

export const SECTIONS = {
  today: 'Board for one role',
  askFirst: 'Move asks first',
  launcher: 'Modules button',
  launcherPhone: 'Modules button (phone)',
} as const;

// ---------------------------------------------------------------- the board, as the page shows it
export type Column = { stage: string; count: number; cards: string[] };

/** Every column in stage order: its name, the number its count badge shows, and the cards' names in order. */
export async function readBoard(scope: Locator): Promise<Column[]> {
  return scope.locator('.pp-pipeline').first().evaluate((root) =>
    [...root.querySelectorAll('.pp-pipeline__column')].map((col) => ({
      stage: (col.querySelector('.pp-pipeline__column-name')?.textContent ?? '').trim(),
      count: parseInt((col.querySelector('.pp-badge')?.textContent ?? '').trim(), 10),
      cards: [...col.querySelectorAll('.pp-pipeline__card')].map((c) => (c.querySelector('.pp-person__name')?.textContent ?? '').trim()),
    })),
  );
}

export function column(scope: Locator, stage: string): Locator {
  return scope.locator('.pp-pipeline__column').filter({ has: scope.page().locator('.pp-pipeline__column-name', { hasText: new RegExp(`^\\s*${esc(stage)}\\s*$`) }) });
}

export function card(scope: Locator, fullName: string): Locator {
  return scope.locator('.pp-pipeline__card').filter({ has: scope.page().locator('.pp-person__name', { hasText: new RegExp(`^\\s*${esc(fullName)}\\s*$`) }) });
}

export function stageOf(board: Column[], fullName: string): string {
  const c = board.find((col) => col.cards.includes(fullName));
  if (!c) throw new Error(`${fullName} is on no column`);
  return c.stage;
}

/** On a phone the board shows one stage at a time: pick it in the "Stage" picker. On desktop nothing to do. */
export async function showStage(scope: Locator, stage: string): Promise<void> {
  const picker = scope.getByLabel('Stage', { exact: true });
  if (!(await picker.isVisible())) return;
  const labels = await picker.locator('option').allTextContents();
  const label = labels.find((l) => l.trim() === stage || l.trim().startsWith(`${stage} (`));
  if (!label) throw new Error(`the stage picker has no option for ${stage}: ${labels.join(', ')}`);
  await picker.selectOption({ label: label.trim() });
  await expect(column(scope, stage)).toBeVisible();
}

/** The counts the phone stage picker shows: "Interview (3)" gives Interview: 3. */
export async function pickerCounts(scope: Locator): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of await scope.getByLabel('Stage', { exact: true }).locator('option').allTextContents()) {
    const m = /^(.*) \((\d+)\)$/.exec(t.trim());
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

/** A card and stages to use, from the gallery's own data: a card with a later stage, and one with an earlier stage. */
export function pickCards(board: Column[]): { forward: { name: string; from: string; to: string }; backward: { name: string; from: string; to: string } } {
  const stages = board.map((c) => c.stage);
  expect(stages.length, 'the board has at least two stages').toBeGreaterThan(1);
  const fwdCol = board.find((c, i) => c.cards.length > 0 && i < board.length - 1);
  const backCol = board.find((c, i) => c.cards.length > 0 && i > 0);
  expect(fwdCol, 'some card has a later stage to go to').toBeTruthy();
  expect(backCol, 'some card has an earlier stage to go back to').toBeTruthy();
  const fi = stages.indexOf(fwdCol!.stage);
  const bi = stages.indexOf(backCol!.stage);
  return {
    forward: { name: fwdCol!.cards[0], from: fwdCol!.stage, to: stages[fi + 1] },
    backward: { name: backCol!.cards[0], from: backCol!.stage, to: stages[bi - 1] },
  };
}

// ---------------------------------------------------------------- drag and drop (desktop: Angular CDK, pointer events)
export async function dragCardTo(page: Page, scope: Locator, fullName: string, stage: string): Promise<void> {
  const from = card(scope, fullName);
  const handle = from.locator('.pp-pipeline__handle');
  const grip = (await handle.count()) ? handle : from;
  await grip.scrollIntoViewIfNeeded();
  const a = (await grip.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 4 });
  const target = column(scope, stage).locator('.pp-pipeline__cards');
  const b = (await target.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 40), { steps: 20 });
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 40) + 2, { steps: 2 });
  await page.mouse.up();
}

// ---------------------------------------------------------------- the dev-only hooks
export type MoveRequest = { card: unknown; from: unknown; to: unknown; index?: unknown; reason: unknown };

/** The requests the `move-requests` line lists: one JSON array, or one JSON object per line. Empty means none. */
export async function requests(scope: Locator): Promise<MoveRequest[]> {
  const line = scope.getByTestId('move-requests');
  await expect(line, 'the section has the dev-only line data-testid="move-requests"').toHaveCount(1);
  const text = ((await line.textContent()) ?? '').trim();
  if (!text) return [];
  try {
    const all = JSON.parse(text);
    return Array.isArray(all) ? all : [all];
  } catch {
    return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l.replace(/,$/, '')));
  }
}

export async function launcherClicks(scope: Locator): Promise<number> {
  const counter = scope.getByTestId('launcher-clicks');
  await expect(counter, 'the section has the dev-only counter data-testid="launcher-clicks"').toHaveCount(1);
  const m = /\d+/.exec((await counter.textContent()) ?? '');
  return m ? Number(m[0]) : 0;
}

/** The dev-only toggle for `launcherOpen`: a checkbox, switch or button whose name says launcherOpen. */
export function launcherOpenToggle(scope: Locator): Locator {
  const name = /launcher\s*open/i;
  return scope.getByRole('checkbox', { name }).or(scope.getByRole('switch', { name })).or(scope.getByRole('button', { name }));
}

// ---------------------------------------------------------------- the Move dialog
export function dialog(page: Page, fullName: string): Locator {
  return page.getByRole('dialog', { name: moveFirst(fullName), exact: true });
}

export const moveTo = (d: Locator) => d.getByLabel(WORDS.field, { exact: true });
export const reason = (d: Locator) => d.getByLabel(WORDS.reason, { exact: true });
export const moveButton = (d: Locator) => d.getByRole('button', { name: WORDS.move, exact: true });

/** The stage "Move to" shows: the selected option's words. */
export async function chosenStage(d: Locator): Promise<string> {
  return moveTo(d).evaluate((s: HTMLSelectElement) => (s.selectedOptions[0]?.textContent ?? '').trim());
}

export async function chooseStage(d: Locator, stage: string): Promise<void> {
  await moveTo(d).selectOption({ label: stage });
}

export async function stageOptions(d: Locator): Promise<string[]> {
  return (await moveTo(d).locator('option').allTextContents()).map((t) => t.trim());
}

/** The text a person sees in the dialog, one entry per block (heading, label, help, button), selects left out. */
export async function visibleBlocks(d: Locator): Promise<string[]> {
  return d.evaluate((root) => {
    const hidden = (el: Element | null): boolean => {
      for (let n = el; n && n !== root.parentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const r = n.getBoundingClientRect();
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return true;
        if (/inset\(50%\)/.test(cs.clipPath) || /rect\(0(px)?,?\s*0(px)?,?\s*0(px)?,?\s*0(px)?\)/.test(cs.clip)) return true;
        if (r.width <= 1 && r.height <= 1) return true;
      }
      return false;
    };
    const blockOf = (el: Element): Element => {
      for (let n: Element | null = el; n && n !== root; n = n.parentElement) if (getComputedStyle(n).display !== 'inline') return n;
      return root;
    };
    const groups = new Map<Element, string>();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const el = t.parentElement!;
      if (el.closest('select, option, script, style')) continue;
      if (!(t.textContent ?? '').trim() || hidden(el)) continue;
      const b = blockOf(el);
      groups.set(b, (groups.get(b) ?? '') + t.textContent);
    }
    return [...groups.values()].map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  });
}

/** Opens the dialog from the card's Move button and returns it. */
export async function openFromButton(page: Page, scope: Locator, fullName: string, how: 'click' | 'tap' | 'Enter' | 'Space' = 'click'): Promise<Locator> {
  const b = card(scope, fullName).getByRole('button', { name: moveFirst(fullName), exact: true });
  await expect(b, `${fullName}'s card has a button named "${moveFirst(fullName)}"`).toBeVisible();
  if (how === 'click') await b.click();
  else if (how === 'tap') await b.tap();
  else { await b.focus(); await page.keyboard.press(how); }
  const d = dialog(page, fullName);
  await expect(d, `a dialog titled "${moveFirst(fullName)}" opens`).toBeVisible();
  return d;
}

// ---------------------------------------------------------------- top navigation
/** The controls of a top bar in page order, with role, name and whether they show. */
export async function barControls(bar: Locator): Promise<string[]> {
  return bar.evaluate((root) => [...root.querySelectorAll('button, a[href], input')].map((e) => {
    const name = e.getAttribute('aria-label') ?? (e.textContent ?? '').trim();
    return `${e.tagName.toLowerCase()}:${name}:${(e as HTMLElement).checkVisibility({ visibilityProperty: true }) ? 'shown' : 'hidden'}`;
  }));
}

/** The launcher's word shows: a text "Modules" inside the button that a person can see. */
export async function wordShown(button: Locator, word: string = WORDS.modules): Promise<boolean> {
  return button.evaluate((btn, w) => {
    const br = btn.getBoundingClientRect();
    const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if ((t.textContent ?? '').trim() !== w) continue;
      let hidden = false;
      for (let e: Element | null = t.parentElement; e && e !== btn.parentElement; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0 || parseFloat(cs.fontSize) === 0) hidden = true;
        if (/inset\(50%\)/.test(cs.clipPath) || /rect\(0(px)?,?\s*0(px)?,?\s*0(px)?,?\s*0(px)?\)/.test(cs.clip)) hidden = true;
      }
      if (hidden) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      const r = range.getBoundingClientRect();
      const across = Math.min(r.right, br.right) - Math.max(r.left, br.left);
      const down = Math.min(r.bottom, br.bottom) - Math.max(r.top, br.top);
      if (r.width >= 4 && r.height >= 4 && across >= 4 && down >= 4) return true;
    }
    return false;
  }, word);
}

/** The svg in the button draws Lucide's layout-grid (the grid icon). */
export async function drawsGrid(button: Locator): Promise<boolean> {
  const want = JSON.stringify((LayoutGrid as unknown as Array<[string, Record<string, string>]>).map(([tag, attrs]) => [tag, Object.keys(attrs).sort().map((k) => `${k}=${attrs[k]}`)]));
  const svgs = await button.locator('svg').evaluateAll((all) => all.map((s) => JSON.stringify([...s.children].map((c) => [c.tagName.toLowerCase(), [...c.attributes].map((a) => `${a.name}=${a.value}`).sort()]))));
  return svgs.includes(want);
}

export function launcher(bar: Locator): Locator {
  return bar.getByRole('button', { name: WORDS.modules, exact: true });
}

// ---------------------------------------------------------------- repository
export function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: PEPLA_WEB, encoding: 'utf8' }).trim();
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
