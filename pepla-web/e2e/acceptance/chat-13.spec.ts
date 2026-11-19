import type { Locator, Page } from '@playwright/test';
import { DocumentsFake, storedEmployee, type FakePerson } from './support/documents-fake';
import { EmployeesFake } from './support/employees-fake';
import { ChatFake } from './support/chat-01/chat-fake';
import { ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';

/**
 * CHAT-13 · Ask Batsi: the message box and the line under it are never cut off.
 * Notes: cards/chat-13.md. Found in the CHAT-11 build review (chat-11-build-review: the phone side panel's box).
 *
 * On a phone the box says "Ask anything about <first name>". With a long first name that wraps onto a second line, and the
 * box was one line tall, so the second line was cut off. The small line under the box ("Batsi changes nothing until you
 * approve.") must be seen in full as well. No new words: both sentences are the approved ones (CHAT-01) and stay exactly as they are.
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

const askButton = (page: Page): Locator => page.getByRole('button', { name: /^Ask Batsi/ });
const panel = (page: Page): Locator => page.getByRole('dialog', { name: 'Batsi', exact: true });
const log = (page: Page): Locator => page.getByRole('log', { name: 'Conversation with Batsi' });
const box = (page: Page): Locator => page.getByRole('textbox', { name: 'Message Batsi' });
const hint = (page: Page): Locator => page.locator('.pp-agent-panel__hint');

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
  await expect(box(s.page)).toBeVisible();
}

/** The full page, opened straight from its address: two questions (no person). */
async function fullPage(s: Setup): Promise<void> {
  await enter(s.page, s.signIn, s.hr);
  await s.page.goto(FULL_PAGE);
  await expect(log(s.page)).toBeVisible();
  await expect(box(s.page)).toBeVisible();
}


const PLACEHOLDER = 'Ask anything about Nomathemba-Annelise';
const HINT = 'Batsi changes nothing until you approve.';

/** True when none of the words of a text box (or its placeholder) are cut off at the bottom or the side. */
async function uncut(el: Locator): Promise<{ scrollH: number; clientH: number; scrollW: number; clientW: number }> {
  return el.evaluate((e) => ({ scrollH: e.scrollHeight, clientH: e.clientHeight, scrollW: e.scrollWidth, clientW: e.clientWidth }));
}

/** Where a thing sits against the screen the person can see and against the panel it belongs to. */
async function inside(el: Locator, holder: Locator): Promise<{ top: number; bottom: number; left: number; right: number; holderBottom: number; holderRight: number; screenBottom: number; screenRight: number }> {
  const h = await holder.evaluate((x) => { const r = x.getBoundingClientRect(); return { b: r.bottom, r: r.right }; });
  return el.evaluate((x, hh) => {
    const r = x.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, holderBottom: hh.b, holderRight: hh.r, screenBottom: window.innerHeight, screenRight: window.innerWidth };
  }, h);
}

const WHERE = ['panel', 'full page'] as const;
const open = (where: (typeof WHERE)[number]) => (where === 'panel' ? panelOnPerson : fullPage);
const holderOf = (page: Page, where: (typeof WHERE)[number]): Locator => (where === 'panel' ? panel(page) : page.locator('.pp-agent-panel--page'));

// ================================================================ AC-1

test.describe('AC-1 The words in the message box are shown in full', () => {
  test('AC-1 In the side panel on a person, the box says "Ask anything about <first name>" and none of it is cut off', async ({ page, signIn, hr, docs }) => {
    await panelOnPerson({ page, signIn, hr, docs: docs! });
    await expect(box(page)).toHaveAttribute('placeholder', PLACEHOLDER);
    const u = await uncut(box(page));
    expect(u.scrollH, 'the box is tall enough for every line of its words').toBeLessThanOrEqual(u.clientH + 1);
    expect(u.scrollW, 'nothing is cut at the side').toBeLessThanOrEqual(u.clientW + 1);
  });

  test('AC-1 On the full page, the words in the box are not cut off', async ({ page, signIn, hr, docs }) => {
    await fullPage({ page, signIn, hr, docs: docs! });
    const u = await uncut(box(page));
    expect(u.scrollH, 'the box is tall enough for every line of its words').toBeLessThanOrEqual(u.clientH + 1);
    expect(u.scrollW, 'nothing is cut at the side').toBeLessThanOrEqual(u.clientW + 1);
  });
});

// ================================================================ AC-2

test.describe('AC-2 The line under the box is shown in full', () => {
  for (const where of WHERE) {
    test(`AC-2 In the ${where}, "${HINT}" is all there, inside the screen and inside the panel`, async ({ page, signIn, hr, docs }) => {
      await open(where)({ page, signIn, hr, docs: docs! });
      await expect(hint(page)).toHaveText(HINT);
      await expect(hint(page)).toBeVisible();
      const u = await uncut(hint(page));
      expect(u.scrollH, 'no line of it is cut at the bottom').toBeLessThanOrEqual(u.clientH + 1);
      expect(u.scrollW, 'nothing is cut at the side').toBeLessThanOrEqual(u.clientW + 1);
      const p = await inside(hint(page), holderOf(page, where));
      expect(p.bottom, 'its bottom is on the screen').toBeLessThanOrEqual(p.screenBottom + 0.5);
      expect(p.bottom, 'its bottom is inside the panel').toBeLessThanOrEqual(p.holderBottom + 0.5);
      expect(p.left, 'its left edge is on the screen').toBeGreaterThanOrEqual(-0.5);
      expect(p.right, 'its right edge is on the screen').toBeLessThanOrEqual(p.screenRight + 0.5);
      await expect(hint(page), 'nothing around it cuts it off').toBeInViewport({ ratio: 1 });
      const hidden = await hint(page).evaluate((e) => {
        const r = e.getBoundingClientRect();
        const corners = [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2]];
        return corners.filter(([x, y]) => { const t = document.elementFromPoint(x, y); return !(t && (t === e || e.contains(t))); }).length;
      });
      expect(hidden, 'every corner of it can be seen: nothing sits on top of it or cuts it').toBe(0);
    });
  }
});

// ================================================================ AC-3

test.describe('AC-3 The box grows with what is typed, to four lines, then scrolls', () => {
  for (const where of WHERE) {
    test(`AC-3 In the ${where}, a long message shows all its lines up to four; more lines scroll inside the box and the Send button and the line under it stay in view`, async ({ page, signIn, hr, docs }) => {
      await open(where)({ page, signIn, hr, docs: docs! });
      const before = (await box(page).boundingBox())!.height;
      await box(page).fill(Array.from({ length: 3 }, (_, i) => `Line ${i + 1} of my question`).join('\n'));
      const three = await uncut(box(page));
      expect(three.scrollH, 'three lines are all shown').toBeLessThanOrEqual(three.clientH + 1);
      const grown = (await box(page).boundingBox())!.height;
      expect(grown, 'the box is taller than when empty').toBeGreaterThan(before + 10);
      await box(page).fill(Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of my question`).join('\n'));
      const many = await uncut(box(page));
      expect(many.scrollH, 'twelve lines do not all fit: it scrolls inside').toBeGreaterThan(many.clientH + 10);
      const lineHeight = await box(page).evaluate((e) => parseFloat(getComputedStyle(e).lineHeight));
      const tall = (await box(page).boundingBox())!.height;
      expect(tall, 'it stops growing at about four lines').toBeLessThanOrEqual(lineHeight * 4 + 40);
      await expect(page.getByRole('button', { name: 'Send' })).toBeInViewport();
      await expect(hint(page)).toBeInViewport();
    });
  }
});

// ================================================================ AC-4

test('AC-4 On a phone the side panel is as tall as the screen the person can see, so nothing at the bottom is hidden', async ({ page, signIn, hr, docs }, info) => {
  test.skip(info.project.name !== 'phone-390', 'Phone only: on a wide screen the panel is a drawer.');
  await panelOnPerson({ page, signIn, hr, docs: docs! });
  const m = await panel(page).evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: window.innerHeight, vh: window.visualViewport?.height ?? window.innerHeight }; });
  expect(Math.abs(m.bottom - m.vh), 'its bottom edge is the bottom of what can be seen').toBeLessThanOrEqual(1);
  expect(Math.abs(m.top), 'its top edge is the top of the screen').toBeLessThanOrEqual(1);
});

// ================================================================ AC-5

test.describe('AC-5 The words stay exactly as approved', () => {
  for (const where of WHERE) {
    test(`AC-5 In the ${where} the line under the box reads exactly "${HINT}" and Send still works`, async ({ page, signIn, hr, docs }) => {
      await open(where)({ page, signIn, hr, docs: docs! });
      await expect(hint(page)).toHaveText(HINT);
      await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
      await expect(box(page)).toBeEditable();
    });
  }
});
