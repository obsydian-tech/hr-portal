import type { Locator, Page } from '@playwright/test';
import { DocumentsFake } from './support/documents-fake';
import { EmployeesFake } from './support/employees-fake';
import { ChatFake } from './support/chat-01/chat-fake';
import { ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';

/**
 * CHAT-12 · The chat keeps its message box in place: on the full page and in the side panel the header and the message
 * box stay on screen and only the conversation scrolls between them (the way ChatGPT and Claude do it).
 * Card notes and what the tests fix where the card is silent: cards/chat-12.md. Fake answers only: nothing calls a paid AI.
 * Each test runs at 1280 and 390 wide.
 */

type Fixtures = { chat: ChatFake | null; docs: DocumentsFake | null; list: EmployeesFake | null };

const test = base.extend<Fixtures>({
  chat: [async ({ context, baseURL }, use) => { if (ON_DEV) return use(null); const f = new ChatFake(new URL(baseURL!).origin); await f.install(context); await use(f); }, { auto: true }],
  docs: [async ({ context, baseURL }, use) => { if (ON_DEV) return use(null); const f = new DocumentsFake(new URL(baseURL!).origin); await f.install(context); await use(f); }, { auto: true }],
  list: [async ({ context, baseURL }, use) => { if (ON_DEV) return use(null); const f = new EmployeesFake(new URL(baseURL!).origin); await f.install(context); await use(f); }, { auto: true }],
});

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake Agent API.');
const FULL_PAGE = '/hr/ask-batsi';
/** A long answer, like the ones in the screenshots that started this card. */
const LONG = Array.from({ length: 14 }, (_, i) => `Line ${i + 1}: this is a long answer from Batsi that goes on and on so the conversation soon needs more room than the screen has.`).join(' ');

const log = (page: Page): Locator => page.getByRole('log', { name: 'Conversation with Batsi' });
const composer = (page: Page): Locator => page.getByRole('textbox', { name: 'Message Batsi' });
const sendButton = (page: Page): Locator => page.getByRole('button', { name: 'Send', exact: true });
const askButton = (page: Page): Locator => page.getByRole('button', { name: /^Ask Batsi/ });
const dialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Batsi', exact: true });

async function enter(page: Page, signIn: SignInPage, hr: Login): Promise<void> {
  await signIn.open();
  await signIn.signInAs(hr);
  await expect(page).toHaveURL(/\/hr$/);
  await expect(page.locator('main h1').first()).toBeVisible();
}

/** Four long questions and answers, so the conversation is much taller than the screen. */
async function longConversation(page: Page, chat: ChatFake): Promise<void> {
  chat.reply = () => ({ message: LONG });
  for (let i = 1; i <= 4; i++) {
    await composer(page).fill(`Question ${i}`);
    await sendButton(page).click();
    await expect(page.getByText(`Line 14:`).nth(i - 1)).toBeVisible();
  }
}

type Rect = { top: number; bottom: number; left: number; right: number; height: number };
const rect = async (l: Locator): Promise<Rect> => l.evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; });
/** The message box as a person sees it: the form that holds the box and Send. */
const box = (page: Page): Locator => page.getByRole('form', { name: 'Message Batsi' });

/** Nothing in the page scrolls: not the window, not the page area. */
async function pageDoesNotScroll(page: Page): Promise<{ window: number; main: number }> {
  return page.evaluate(() => {
    const doc = document.scrollingElement!;
    const main = document.querySelector('main')!;
    return { window: doc.scrollHeight - doc.clientHeight, main: main.scrollHeight - main.clientHeight };
  });
}

async function expectOnScreen(page: Page, l: Locator, what: string): Promise<void> {
  const r = await rect(l);
  const { h, w } = await page.evaluate(() => ({ h: window.innerHeight, w: window.innerWidth }));
  expect(r.top, `${what} starts on screen`).toBeGreaterThanOrEqual(0);
  expect(r.bottom, `${what} ends on screen`).toBeLessThanOrEqual(h + 0.5);
  expect(r.left, `${what} is inside the width`).toBeGreaterThanOrEqual(0);
  expect(r.right, `${what} is inside the width`).toBeLessThanOrEqual(w + 0.5);
}

const scrollLog = (page: Page, to: 'top' | 'bottom'): Promise<void> =>
  log(page).evaluate((e, where) => { e.scrollTop = where === 'top' ? 0 : e.scrollHeight; }, to);

// ================================================================ the full page

test.describe('Full page chat', () => {
  test('AC-1 After a long conversation the page does not scroll: the message box is on screen at the bottom', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await page.goto(FULL_PAGE);
    await expect(composer(page)).toBeVisible();
    await longConversation(page, chat!);
    const over = await pageDoesNotScroll(page);
    expect(over.window, 'the window does not scroll').toBeLessThanOrEqual(1);
    expect(over.main, 'the page area does not scroll').toBeLessThanOrEqual(1);
    await expectOnScreen(page, box(page), 'the message box');
    await expectOnScreen(page, composer(page), 'the box to type in');
    await expectOnScreen(page, sendButton(page), 'Send');
    const b = await rect(box(page));
    const h = await page.evaluate(() => window.innerHeight);
    expect(h - b.bottom, 'the box sits at the bottom of the screen, not part way up').toBeLessThanOrEqual(40);
    const l = await log(page).evaluate((e) => ({ scroll: e.scrollHeight, client: e.clientHeight }));
    expect(l.scroll, 'the conversation is taller than its area, so it scrolls in there').toBeGreaterThan(l.client + 100);
  });

  test('AC-2 Reading older answers moves only the conversation: the header and the message box stay where they are', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await page.goto(FULL_PAGE);
    await longConversation(page, chat!);
    const back = page.getByRole('link', { name: 'Back to Today' });
    expect(await log(page).evaluate((e) => e.scrollTop), 'the conversation was down at the newest message').toBeGreaterThan(100);
    const before = { back: await rect(back), box: await rect(box(page)), title: await rect(page.getByRole('heading', { level: 1, name: 'Batsi' })) };
    await scrollLog(page, 'top');
    expect(await log(page).evaluate((e) => e.scrollTop), 'the conversation moved to the start').toBe(0);
    const after = { back: await rect(back), box: await rect(box(page)), title: await rect(page.getByRole('heading', { level: 1, name: 'Batsi' })) };
    expect(after, 'the header and the box did not move').toEqual(before);
    await expectOnScreen(page, back, 'Back to Today');
    await expectOnScreen(page, box(page), 'the message box');
    expect((await pageDoesNotScroll(page)).window, 'the window still does not scroll').toBeLessThanOrEqual(1);
  });

  test('AC-3 A new answer is followed: the newest message is in view at the bottom of the conversation', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await page.goto(FULL_PAGE);
    await longConversation(page, chat!);
    chat!.reply = () => ({ message: 'This is the newest answer.' });
    await scrollLog(page, 'bottom');
    await composer(page).fill('One more');
    await sendButton(page).click();
    const newest = page.getByText('This is the newest answer.');
    await expect(newest).toBeVisible();
    const inside = await newest.evaluate((n, root) => {
      const a = n.getBoundingClientRect(), b = (root as HTMLElement).getBoundingClientRect();
      return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
    }, await log(page).elementHandle());
    expect(inside, 'the newest answer is inside the conversation area').toBe(true);
    expect(await log(page).evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight), 'the conversation is at its end').toBeLessThanOrEqual(24);
    await expectOnScreen(page, box(page), 'the message box');
  });

  test('AC-4 A person who scrolled up to read is not pulled down when the answer arrives', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await page.goto(FULL_PAGE);
    await longConversation(page, chat!);
    chat!.mode = 'hold';
    await composer(page).fill('A slow question');
    await sendButton(page).click();
    await scrollLog(page, 'top');
    chat!.reply = () => ({ message: LONG });
    chat!.release();
    await expect(page.getByText('Line 14:')).toHaveCount(5);
    await page.waitForTimeout(150);
    expect(await log(page).evaluate((e) => e.scrollTop), 'still where they put it').toBeLessThanOrEqual(1);
  });

  test('AC-5 A message with many lines grows the box a little but never moves it off the screen', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await page.goto(FULL_PAGE);
    await longConversation(page, chat!);
    await composer(page).fill(Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n'));
    await expectOnScreen(page, box(page), 'the message box');
    await expectOnScreen(page, sendButton(page), 'Send');
    expect((await pageDoesNotScroll(page)).window).toBeLessThanOrEqual(1);
  });
});

// ================================================================ the side panel

test.describe('Side panel', () => {
  test('AC-6 In the side panel the box stays at the bottom and only the conversation scrolls', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await askButton(page).click();
    await expect(dialog(page)).toBeVisible();
    await longConversation(page, chat!);
    await expectOnScreen(page, box(page), 'the message box');
    await expectOnScreen(page, dialog(page).getByRole('button', { name: 'Close Batsi' }), 'Close');
    const before = { box: await rect(box(page)), close: await rect(dialog(page).getByRole('button', { name: 'Close Batsi' })) };
    await scrollLog(page, 'top');
    const after = { box: await rect(box(page)), close: await rect(dialog(page).getByRole('button', { name: 'Close Batsi' })) };
    expect(after, 'the header and the box did not move').toEqual(before);
    const l = await log(page).evaluate((e) => ({ scroll: e.scrollHeight, client: e.clientHeight }));
    expect(l.scroll, 'the conversation scrolls inside the panel').toBeGreaterThan(l.client + 100);
    const h = await page.evaluate(() => window.innerHeight);
    expect(h - (await rect(box(page))).bottom, 'the box is at the bottom of the screen').toBeLessThanOrEqual(40);
  });

  test('AC-7 Scrolling the conversation in the side panel does not scroll the page behind it', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await askButton(page).click();
    await longConversation(page, chat!);
    const behind = () => page.evaluate(() => ({ w: document.scrollingElement!.scrollTop, m: document.querySelector('main')!.scrollTop }));
    const before = await behind();
    await scrollLog(page, 'top');
    await log(page).hover();
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(150);
    expect(await behind(), 'the page behind did not move').toEqual(before);
  });
});
