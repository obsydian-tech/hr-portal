import type { Locator, Page } from '@playwright/test';
import { DocumentsFake, storedEmployee, type FakePerson } from './support/documents-fake';
import { EmployeesFake } from './support/employees-fake';
import { ChatFake } from './support/chat-01/chat-fake';
import { ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';

/**
 * CHAT-11 · Ask Batsi: the suggested questions look and work like the design system's list.
 * Spec: /mnt/project-files/ask-batsi-chat/CHAT-11-suggestion-buttons.md (AC-1 to AC-7). Notes: cards/chat-11.md.
 *
 * The design system draws a suggestion as a link row (`a.pp-agent-panel__suggestion`). The app draws it as a button, because
 * picking one asks the question. These tests put the design system's own link row into the same list and require the button
 * rows to look like it. No new words: the three questions are the approved ones (W05 to W07, CHAT-01).
 *
 * Fake answers only (support/chat-01/chat-fake.ts, imported, not changed). No test calls Bedrock or any paid AI.
 * Each test runs at 1280 and 390 wide (projects in ./playwright.config.ts).
 */

type Fixtures = { chat: ChatFake | null; docs: DocumentsFake | null; list: EmployeesFake | null };

const test = base.extend<Fixtures>({
  chat: [
    async ({ context, baseURL }, use) => {
      if (ON_DEV) return use(null);
      const fake = new ChatFake(new URL(baseURL!).origin);
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
  docs: [
    async ({ context, baseURL }, use) => {
      if (ON_DEV) return use(null);
      const fake = new DocumentsFake(new URL(baseURL!).origin);
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
  list: [
    async ({ context, baseURL }, use) => {
      if (ON_DEV) return use(null);
      const fake = new EmployeesFake(new URL(baseURL!).origin);
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
});

test.beforeEach(() => {
  test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake Agent API.');
});

/** A long first name, so the first question is long enough to wrap on a phone. */
const PERSON: FakePerson = {
  employee: storedEmployee({ first_name: 'Nomathemba-Annelise', last_name: 'Mokoena-Vermeulen', job_title: 'Payroll Clerk', department: 'Finance' }),
  documents: [],
};
const personPath = `/hr/employees/${PERSON.employee.employee_id}`;
const FULL_PAGE = '/hr/ask-batsi';

/** The approved questions (CHAT-01 words W05 to W07). */
const Q1 = 'Is Nomathemba-Annelise ready to start on Monday?';
const Q2 = 'Who hasn’t sent their documents?';
const Q3 = 'Which candidates are at risk?';

const askButton = (page: Page): Locator => page.getByRole('button', { name: /^Ask Batsi/ });
const panel = (page: Page): Locator => page.getByRole('dialog', { name: 'Batsi', exact: true });
const log = (page: Page): Locator => page.getByRole('log', { name: 'Conversation with Batsi' });
const list = (page: Page): Locator => page.getByRole('list', { name: 'Tasks Batsi can do' });
const rows = (page: Page): Locator => list(page).locator('.pp-agent-panel__suggestion');
const pick = (page: Page, label: string): Locator => list(page).getByRole('button', { name: label, exact: true });

type Setup = { page: Page; signIn: SignInPage; hr: Login; docs: DocumentsFake };

async function enter(page: Page, signIn: SignInPage, hr: Login): Promise<void> {
  await signIn.open();
  await signIn.signInAs(hr);
  await expect(page).toHaveURL(/\/hr$/);
  await expect(page.locator('main h1').first()).toBeVisible();
}

/** The side panel, opened on a person's page: three questions. */
async function panelOnPerson(s: Setup): Promise<void> {
  s.docs.add(PERSON);
  await enter(s.page, s.signIn, s.hr);
  await s.page.goto(personPath);
  await expect(s.page.getByRole('heading', { level: 1, name: 'Nomathemba-Annelise Mokoena-Vermeulen' })).toBeVisible();
  await askButton(s.page).click();
  await expect(panel(s.page)).toBeVisible();
  await expect(rows(s.page)).toHaveCount(3);
}

/** The full page, opened straight from its address: two questions (no person). */
async function fullPage(s: Setup): Promise<void> {
  await enter(s.page, s.signIn, s.hr);
  await s.page.goto(FULL_PAGE);
  await expect(log(s.page)).toBeVisible();
  await expect(rows(s.page)).toHaveCount(2);
}

const KIT_ID = 'chat-11-kit-row';

/** Adds the design system's own link row (as the kit draws it) to the end of the same list. */
async function addKitRow(page: Page): Promise<Locator> {
  await list(page).evaluate((ul, id) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.id = id;
    a.className = 'pp-agent-panel__suggestion';
    a.href = '#kit';
    a.addEventListener('click', (e) => e.preventDefault());
    const span = document.createElement('span');
    span.textContent = 'Kit row';
    a.append(span);
    li.append(a);
    ul.append(li);
  }, KIT_ID);
  return page.locator(`#${KIT_ID}`);
}

/** What a row looks like: the properties the design system sets or that a browser gives a button by default. */
const LOOK = [
  'background-color', 'background-image',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-left-radius', 'box-shadow',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-left', 'margin-right',
  'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'text-align', 'justify-content', 'align-items',
  'column-gap', 'cursor', 'text-decoration-line', 'appearance', 'opacity', 'min-height',
] as const;

async function look(row: Locator): Promise<Record<string, string>> {
  return row.evaluate((el, props) => {
    const cs = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
  }, [...LOOK]);
}

/** Width of the row against the width of its list item, and whether the label is cut off. */
async function fit(row: Locator): Promise<{ row: number; item: number; left: number; itemLeft: number; labelCut: boolean }> {
  return row.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const li = el.parentElement!.getBoundingClientRect();
    const label = el.querySelector('span');
    return {
      row: r.width, item: li.width, left: r.left, itemLeft: li.left,
      labelCut: !!label && (
        label.scrollWidth > label.clientWidth + 1 ||
        label.scrollHeight > label.clientHeight + 1 ||
        label.getBoundingClientRect().right > r.right + 0.5 ||
        label.getBoundingClientRect().bottom > r.bottom + 0.5),
    };
  });
}

async function moveAway(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
}

// ================================================================ AC-1

test.describe('AC-1 Each question is a full-width row of the list', () => {
  for (const where of ['panel', 'full page'] as const) {
    test(`AC-1 In the ${where} every question fills its row, edge to edge, and nothing scrolls sideways`, async ({ page, signIn, hr, docs }) => {
      await (where === 'panel' ? panelOnPerson : fullPage)({ page, signIn, hr, docs: docs! });
      const n = await rows(page).count();
      for (let i = 0; i < n; i++) {
        const f = await fit(rows(page).nth(i));
        expect(Math.abs(f.row - f.item), `row ${i + 1} is as wide as its list item`).toBeLessThanOrEqual(1);
        expect(Math.abs(f.left - f.itemLeft), `row ${i + 1} starts at the list item's edge`).toBeLessThanOrEqual(1);
      }
      const sideways = await list(page).evaluate((ul) => ul.scrollWidth - ul.clientWidth);
      expect(sideways, 'the list does not scroll sideways').toBeLessThanOrEqual(1);
      const logSideways = await log(page).evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(logSideways, 'the conversation does not scroll sideways').toBeLessThanOrEqual(1);
    });
  }
});

// ================================================================ AC-2

test.describe('AC-2 A question row looks like the design system row', () => {
  for (const where of ['panel', 'full page'] as const) {
    test(`AC-2 In the ${where} each question has the design system row's look: no grey box, no border of its own, text from the left`, async ({ page, signIn, hr, docs }) => {
      await (where === 'panel' ? panelOnPerson : fullPage)({ page, signIn, hr, docs: docs! });
      const kit = await addKitRow(page);
      await moveAway(page);
      const want = await look(kit);
      const n = (await rows(page).count()) - 1;
      expect(n, 'questions besides the kit row').toBeGreaterThanOrEqual(2);
      for (let i = 0; i < n; i++) {
        const row = rows(page).nth(i);
        await expect(row, `row ${i + 1} is a button`).toHaveJSProperty('tagName', 'BUTTON');
        expect(await look(row), `row ${i + 1} looks like the design system row`).toEqual(want);
      }
      const icon = await rows(page).first().locator('svg').evaluate((el) => getComputedStyle(el).color);
      const wantIcon = await kit.evaluate((a) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--color-icon-subtle)';
        a.append(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      });
      expect(icon, 'the icon keeps the design system icon colour').toBe(wantIcon);
    });
  }
});

// ================================================================ AC-3

test('AC-3 Pointing at a question shows the design system hover colour, and only on that row', async ({ page, signIn, hr, docs }) => {
  await panelOnPerson({ page, signIn, hr, docs: docs! });
  const kit = await addKitRow(page);
  await kit.hover();
  const wantHover = (await look(kit))['background-color'];
  await moveAway(page);
  const rest = (await look(kit))['background-color'];
  expect(wantHover, 'the kit row changes colour on hover').not.toBe(rest);

  await rows(page).nth(1).hover();
  expect((await look(rows(page).nth(1)))['background-color'], 'the hovered question').toBe(wantHover);
  expect((await look(rows(page).nth(0)))['background-color'], 'a question not hovered').toBe(rest);
  expect((await look(rows(page).nth(1)))['cursor'], 'a hand over the hovered question').toBe('pointer');
});

// ================================================================ AC-4

test('AC-4 Picking a question asks exactly that question, once, and the list goes away', async ({ page, signIn, hr, docs, chat }) => {
  await panelOnPerson({ page, signIn, hr, docs: docs! });
  chat!.reply = () => ({ message: 'Nothing to report.' });
  await pick(page, Q2).click();
  await expect(log(page).getByText(Q2, { exact: true }), 'the question shows in the conversation').toBeVisible();
  await expect(log(page).getByText('Nothing to report.')).toBeVisible();
  expect(chat!.chats(), 'asked once').toHaveLength(1);
  expect(chat!.chats()[0]!.body.message, 'the words asked are the words on the row').toBe(Q2);
  await expect(list(page), 'the questions go once one is asked').toHaveCount(0);
});

// ================================================================ AC-5

test('AC-5 With the keyboard: each question takes focus in order, shows the focus ring, and Enter asks it', async ({ page, signIn, hr, docs, chat }) => {
  await panelOnPerson({ page, signIn, hr, docs: docs! });
  const kit = await addKitRow(page);
  const ringOf = (el: Locator) => el.evaluate((e) => {
    const cs = getComputedStyle(e);
    return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset };
  });
  // The kit row sits after the third question. Tab onto it from the keyboard to read its ring.
  await rows(page).nth(2).focus();
  await page.keyboard.press('Tab');
  await expect(kit).toBeFocused();
  const ring = await ringOf(kit);
  expect(ring.style, 'the kit row shows a ring').not.toBe('none');

  // Back through the questions with the keyboard: third, second, first.
  for (const [i, q] of [[2, Q3], [1, Q2], [0, Q1]] as const) {
    await page.keyboard.press('Shift+Tab');
    await expect(pick(page, q), `question ${i + 1} has focus`).toBeFocused();
    expect(await ringOf(pick(page, q)), `question ${i + 1} shows the design system focus ring`).toEqual(ring);
  }

  chat!.reply = () => ({ message: 'Nothing to report.' });
  await page.keyboard.press('Tab');
  await expect(pick(page, Q2)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(log(page).getByText(Q2, { exact: true })).toBeVisible();
  expect(chat!.chats()).toHaveLength(1);
  expect(chat!.chats()[0]!.body.message).toBe(Q2);
});

// ================================================================ AC-6

test('AC-6 Offline, the questions are shown as not available and picking one asks nothing', async ({ page, context, signIn, hr, docs, chat }) => {
  await panelOnPerson({ page, signIn, hr, docs: docs! });
  await moveAway(page);
  const before = await look(rows(page).nth(0));
  await context.setOffline(true);
  await expect(panel(page).getByText('You are offline. You can ask again when you are back online.', { exact: true })).toBeVisible();
  for (const q of [Q1, Q2, Q3]) await expect(pick(page, q), `"${q}" cannot be picked`).toBeDisabled();

  const off = await look(rows(page).nth(0));
  expect(off.color, 'the words turn the disabled colour').not.toBe(before.color);
  const disabledText = await rows(page).nth(0).evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--color-text-disabled)';
    el.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(off.color, 'the design system disabled text colour').toBe(disabledText);
  expect(off.cursor, 'no hand over a question that cannot be picked').toBe('not-allowed');
  expect(off['background-color'], 'still no grey box').toBe(before['background-color']);

  await rows(page).nth(1).hover({ force: true });
  expect((await look(rows(page).nth(1)))['background-color'], 'no hover colour while it cannot be picked').toBe(before['background-color']);
  await pick(page, Q2).click({ force: true });
  await page.waitForTimeout(300);
  expect(chat!.chats(), 'nothing asked').toHaveLength(0);
  await expect(log(page).locator('.pp-agent-panel__message').filter({ hasText: Q2 }), 'no question in the conversation').toHaveCount(0);
  await expect(rows(page), 'the questions are still there to pick later').toHaveCount(3);

  await context.setOffline(false);
  await expect(pick(page, Q2)).toBeEnabled();
});

// ================================================================ AC-7

test('AC-7 A long question wraps inside its row: the whole question is readable and inside the panel', async ({ page, signIn, hr, docs }) => {
  await panelOnPerson({ page, signIn, hr, docs: docs! });
  const row = pick(page, Q1);
  await expect(row).toBeVisible();
  const f = await fit(row);
  expect(f.labelCut, 'no part of the question is cut off').toBe(false);
  const inside = await row.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const p = el.closest('.pp-agent-panel')!.getBoundingClientRect();
    return r.left >= p.left - 0.5 && r.right <= p.right + 0.5 && r.right <= window.innerWidth + 0.5;
  });
  expect(inside, 'the row stays inside the panel and the screen').toBe(true);
  const label = row.locator('span');
  const text = (await label.innerText()).replace(/\s+/g, ' ').trim();
  expect(text, 'the full question, word for word').toBe(Q1);
  const wraps = await row.evaluate((el) => {
    const cs = getComputedStyle(el);
    const s = getComputedStyle(el.querySelector('span')!);
    return cs.whiteSpace !== 'nowrap' && s.whiteSpace !== 'nowrap' && s.textOverflow !== 'ellipsis';
  });
  expect(wraps, 'the question wraps rather than being shortened').toBe(true);
});
