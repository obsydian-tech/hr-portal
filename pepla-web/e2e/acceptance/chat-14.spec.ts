import type { Locator, Page } from '@playwright/test';
import { DocumentsFake } from './support/documents-fake';
import { EmployeesFake } from './support/employees-fake';
import { ChatFake } from './support/chat-01/chat-fake';
import { ChatsFake, chat, chatId, type StoredChat, type StoredMessage } from './support/chat-14/chats-fake';
import { ON_DEV, avatarButton, expect, test as base, type Login, type SignInPage } from './support/fixtures';

/**
 * CHAT-14 · Ask Batsi past chats: the list, opening an old chat, and deleting chats (screens).
 * Spec: /mnt/project-files/ask-batsi-chat/CHAT-14-past-chats-screens.md (AC-1 to AC-26). Notes, and the contract these tests fix
 * where the card is silent: cards/chat-14.md.
 *
 * Fake answers only: the chat routes and the question route are answered in the browser by support/chat-14/chats-fake.ts.
 * No test calls Bedrock or any paid AI; AC-26 shows it. The words are the approved ones (words.json) and the ones the card
 * logs (W14-1 to W14-5). Each test runs at 1280 and 390 wide unless it says one width (projects in ./playwright.config.ts).
 */

type Fixtures = { chats: ChatsFake | null; docs: DocumentsFake | null; list: EmployeesFake | null };

const test = base.extend<Fixtures>({
  // Not automatic: AC-25 runs the page with CHAT-01's fake, which does not answer /v1/chats.
  chats: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new ChatsFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
    // "The fake checks every chats call carries the signed-in person's ID token as its only identity" (card, Acceptance).
    expect(fake.violations, 'every chats call carries the ID token and nothing else that names a person or a company').toEqual([]);
  },
  docs: [async ({ context, baseURL }, use) => { if (ON_DEV) return use(null); const f = new DocumentsFake(new URL(baseURL!).origin); await f.install(context); await use(f); }, { auto: true }],
  list: [async ({ context, baseURL }, use) => { if (ON_DEV) return use(null); const f = new EmployeesFake(new URL(baseURL!).origin); await f.install(context); await use(f); }, { auto: true }],
});

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake Agent API.');
const phoneOnly = (name: string) => test.skip(name !== 'phone-390', 'Runs at 390 wide only.');
const desktopOnly = (name: string) => test.skip(name !== 'desktop-1280', 'Runs at 1280 wide only.');

const FULL_PAGE = '/hr/ask-batsi';

/** The words, as approved (words.json) and as the card logs them. */
const W = {
  back: 'Back to Today',
  newChat: 'New chat',
  search: 'Search chats',
  deleteChat: 'Delete chat',
  deleteAll: 'Delete all my chats',
  chats: 'Chats',
  cancel: 'Cancel',
  close: 'Close',
  today: 'Today',
  yesterday: 'Yesterday',
  previous: 'Previous 7 days',
  looking: 'Looking at Today',
  hello: 'Hi Jane. Pick a question or ask me.',
  notOn: 'Ask Batsi is not switched on for your company.',
  notOnNext: 'Ask your administrator to switch it on.',
  askError: 'I could not answer that. Try again in a few minutes.',
  retry: 'Try again',
  failed: 'It did not go through. Nothing was changed.',
  oneTitle: 'Delete this chat?',
  oneText: 'This removes the chat for good. The audit log keeps that a chat was deleted, not what it said.',
  allTitle: 'Delete all your chats?',
  allText: (n: number) => `This removes all ${n} of your chats for good. The audit log keeps that you deleted them, not what they said.`,
  allTextNoNumber: 'This removes all of your chats for good. The audit log keeps that you deleted them, not what they said.',
  noMatch: 'No chats found.',
  loadFailed: 'We could not load your chats.',
  openFailed: 'We could not open this chat.',
};

// ---------------------------------------------------------------- the chats and the clock

/** 19 Nov 2026, 18:00 in South Africa (16:00 UTC). The tests run with the page's clock stopped here, and the fake's too. */
const NOW = new Date('2026-11-19T16:00:00Z');
/** A time in South Africa: sast('2026-11-18', '15:12'). */
const sast = (day: string, time: string): string => new Date(`${day}T${time}:00+02:00`).toISOString();

const T = {
  kagiso: 'Is Kagiso ready to start on Monday?',
  risk: 'Which candidates are at risk?',
  docs: 'Who hasn’t sent their documents?',
  week: 'Who is starting this week?',
};
/** Two today, one yesterday, one five days ago (AC-1). */
const FOUR = (): StoredChat[] => [
  chat(1, T.kagiso, sast('2026-11-19', '15:40')),
  chat(2, T.risk, sast('2026-11-19', '09:05')),
  chat(3, T.docs, sast('2026-11-18', '15:12')),
  chat(4, T.week, sast('2026-11-14', '10:30')),
];

/** Many chats, newest first by number: "Chat number 001" is the newest. All today. */
const MANY = (count: number, from = 100): StoredChat[] =>
  Array.from({ length: count }, (_, i) => chat(from + i, `Chat number ${String(i + 1).padStart(3, '0')}`, new Date(NOW.getTime() - 5 * 60_000 - i * 1000)));

type Setup = { page: Page; signIn: SignInPage; hr: Login; chats: ChatsFake };
type Who = { page: Page; signIn: SignInPage; hr: Login };

/** The page and the fake agree what time it is, before anything runs. */
async function clockAt(s: { page: Page; chats: ChatsFake }, now: Date = NOW): Promise<void> {
  await s.page.clock.setFixedTime(now);
  s.chats.now = () => now;
}

async function signedIn(s: Who): Promise<void> {
  await s.signIn.open();
  await s.signIn.signInAs(s.hr);
  await expect(s.page).toHaveURL(/\/hr$/);
  await expect(s.page.locator('main h1').first()).toBeVisible();
}

/** Seeds the person's chats, sets the clock, signs in and opens the full page. */
async function onFullPage(s: Setup, stored: StoredChat[] = FOUR(), now: Date = NOW): Promise<void> {
  s.chats.seed(s.hr.email, stored);
  await clockAt(s, now);
  await signedIn(s);
  await s.page.goto(FULL_PAGE);
  await expect(composer(s.page)).toBeVisible();
}

// ---------------------------------------------------------------- things found by their words

const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 768;
const log = (page: Page): Locator => page.getByRole('log', { name: 'Conversation with Batsi' });
const composer = (page: Page): Locator => page.getByRole('textbox', { name: 'Message Batsi' });
const sendButton = (page: Page): Locator => page.getByRole('button', { name: 'Send', exact: true });
const panel = (page: Page): Locator => page.getByRole('dialog', { name: 'Batsi', exact: true });
const askButton = (page: Page): Locator => page.getByRole('button', { name: /^Ask Batsi/ });
const heading = (page: Page): Locator => page.getByRole('heading', { level: 1 });
const nav = (page: Page): Locator => page.getByRole('navigation', { name: W.chats, exact: true });
const mainNav = (page: Page): Locator => page.getByRole('navigation', { name: 'Main', exact: true });
const menuButton = (page: Page): Locator => page.getByRole('button', { name: 'Open menu', exact: true });
const topBar = (page: Page): Locator => page.locator('.pp-top-navigation');
const backLink = (page: Page): Locator => page.getByRole('link', { name: W.back, exact: true });
/** A link or a button in a scope, by its exact name ("Each item is a real link or button"). */
const pick = (scope: Locator, name: string): Locator => scope.getByRole('link', { name, exact: true }).or(scope.getByRole('button', { name, exact: true }));
const entry = (page: Page, name: string): Locator => pick(nav(page), name);
const group = (page: Page, name: string): Locator => nav(page).getByRole('list', { name, exact: true });
const rowsOf = (l: Locator): Locator => l.getByRole('link').or(l.getByRole('button'));
const headerDelete = (page: Page): Locator => page.getByRole('button', { name: W.deleteChat, exact: true }).first();
/** The design system draws a danger dialog as an alert dialog: either role is fine, the name is what counts. */
const dialogNamed = (page: Page, name: string): Locator => page.getByRole('dialog', { name, exact: true }).or(page.getByRole('alertdialog', { name, exact: true }));
const oneDialog = (page: Page): Locator => dialogNamed(page, W.oneTitle);
const allDialog = (page: Page): Locator => dialogNamed(page, W.allTitle);
const searchBox = (page: Page): Locator => page.getByRole('searchbox', { name: W.search, exact: true }).or(page.getByRole('textbox', { name: W.search, exact: true }));
const said = (scope: Locator, text: string): Locator => scope.getByText(text, { exact: true });

/** The list is on the screen. On a phone it slides in from the left; closed, it waits off the screen (or hidden: either is "not shown"). */
async function listShown(page: Page): Promise<boolean> {
  if (!(await nav(page).count())) return false;
  return nav(page).first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    const style = getComputedStyle(e);
    return style.visibility !== 'hidden' && style.display !== 'none' && r.width > 0 && r.left >= -2 && r.right > 40 && r.left < window.innerWidth - 40;
  });
}

/** The list is not moving: its left edge is the same on two reads a moment apart (it may be sliding in or out). */
async function settled(page: Page): Promise<void> {
  if (!(await nav(page).count())) return;
  let last = NaN;
  for (let i = 0; i < 20; i++) {
    const left = await nav(page).first().evaluate((e) => Math.round(e.getBoundingClientRect().left));
    if (left === last) return;
    last = left;
    await page.waitForTimeout(120);
  }
}

/** On a phone the list is behind the top bar menu button on this page. */
async function ensureList(page: Page): Promise<void> {
  if (!isPhone(page)) return;
  await settled(page);
  if (await listShown(page)) return;
  await menuButton(page).click();
  await expect.poll(() => listShown(page), { message: 'the list opened' }).toBe(true);
}

async function closeList(page: Page): Promise<void> {
  if (!isPhone(page)) return;
  await settled(page);
  if (!(await listShown(page))) return;
  await menuButton(page).click();
  await expect.poll(() => listShown(page), { message: 'the list closed' }).toBe(false);
}

async function open(page: Page, title: string): Promise<void> {
  await ensureList(page);
  await entry(page, title).click();
  await expect(heading(page)).toHaveText(title);
  await expect(heading(page), 'focus moves to the chat’s heading').toBeFocused();
}

async function ask(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await sendButton(page).click();
}

type Rect = { top: number; bottom: number; left: number; right: number; width: number; height: number };
const rect = async (l: Locator): Promise<Rect> => l.evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; });
const viewport = (page: Page) => page.evaluate(() => ({ h: window.innerHeight, w: window.innerWidth }));

async function expectOnScreen(page: Page, l: Locator, what: string): Promise<void> {
  const r = await rect(l);
  const { h, w } = await viewport(page);
  expect(r.width, `${what} has a size`).toBeGreaterThan(0);
  expect(r.top, `${what} starts on screen`).toBeGreaterThanOrEqual(0);
  expect(r.bottom, `${what} ends on screen`).toBeLessThanOrEqual(h + 0.5);
  expect(r.left, `${what} is inside the width`).toBeGreaterThanOrEqual(0);
  expect(r.right, `${what} is inside the width`).toBeLessThanOrEqual(w + 0.5);
}

/** On screen and not under the top bar. */
async function expectClearOfTopBar(page: Page, l: Locator, what: string): Promise<void> {
  await expectOnScreen(page, l, what);
  const bar = await rect(topBar(page));
  const r = await rect(l);
  // On a wide screen the sidebar column runs up beside the top bar, not under it.
  if (r.right <= bar.left + 1 || r.left >= bar.right - 1) return;
  expect(r.top, `${what} is not under the top bar`).toBeGreaterThanOrEqual(bar.bottom - 1.5);
}

/** What is on top at the middle of the element: the element itself, or something inside it. */
async function expectNotCovered(l: Locator, what: string): Promise<void> {
  const ok = await l.evaluate((e) => {
    const r = e.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (e.contains(hit) || hit.contains(e));
  });
  expect(ok, `${what} is not covered by anything`).toBe(true);
}

async function pageDoesNotScroll(page: Page): Promise<{ window: number; main: number }> {
  return page.evaluate(() => {
    const doc = document.scrollingElement!;
    const main = document.querySelector('main')!;
    return { window: doc.scrollHeight - doc.clientHeight, main: main.scrollHeight - main.clientHeight };
  });
}

/** The words of everything on the screen: the page's text, for "nothing of that shows" checks. */
const screenText = (page: Page): Promise<string> => page.locator('body').innerText();

/** The element inside (or equal to) `l` that scrolls by itself, if any. */
async function scroller(l: Locator): Promise<Locator | null> {
  const mark = await l.evaluate((root) => {
    const all = [root, ...Array.from(root.querySelectorAll('*'))] as HTMLElement[];
    const found = all.find((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 20);
    if (!found) return null;
    found.setAttribute('data-acceptance-scroller', 'yes');
    return true;
  });
  return mark ? l.page().locator('[data-acceptance-scroller="yes"]') : null;
}

/** Every text the page shows from now on is checked for these words; the hits are kept. */
async function watchFor(page: Page, words: string[]): Promise<() => Promise<string[]>> {
  await page.evaluate((w) => {
    const hits = new Set<string>();
    (window as any).__acceptanceHits = hits;
    const look = () => { const t = document.body.textContent ?? ''; for (const x of w) if (t.includes(x)) hits.add(x); };
    new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    look();
  }, words);
  return () => page.evaluate(() => Array.from((window as any).__acceptanceHits as Set<string>));
}

/** The red button of a delete dialog: "Delete chat" in the first, "Delete all my chats" in the second. */
const confirmButton = (dialog: Locator, all: boolean): Locator => dialog.getByRole('button', { name: all ? W.deleteAll : W.deleteChat, exact: true });

// ================================================================ AC-1, AC-2, AC-3, AC-4: the list

test.describe('The list', () => {
  test('AC-1 The column shows Back to Today, New chat, Search chats, the groups newest first, and Delete all my chats after the last chat; the app’s own sidebar is not there', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    await onFullPage({ page, signIn, hr, chats: chats! });
    await ensureList(page);
    const column = nav(page);
    await expect(column).toBeVisible();
    if (isPhone(page)) await expect(page.getByRole('heading', { name: W.chats, exact: true }), 'the phone list is headed "Chats"').toBeVisible();
    else await expect(backLink(page), 'Back to Today is at the top of the column').toBeVisible();
    await expect(entry(page, W.newChat)).toBeVisible();
    await expect(entry(page, W.search)).toBeVisible();
    await expect(group(page, W.today)).toBeVisible();
    await expect(group(page, W.yesterday)).toBeVisible();
    await expect(group(page, W.previous)).toBeVisible();
    await expect(rowsOf(group(page, W.today)), 'two chats today, newest first').toHaveCount(2);
    await expect(rowsOf(group(page, W.yesterday))).toHaveCount(1);
    await expect(rowsOf(group(page, W.previous))).toHaveCount(1);
    await expect(pick(group(page, W.today), T.kagiso)).toBeVisible();
    await expect(pick(group(page, W.today), T.risk)).toBeVisible();
    await expect(pick(group(page, W.yesterday), T.docs)).toBeVisible();
    await expect(pick(group(page, W.previous), T.week)).toBeVisible();
    // The order down the column.
    const names = [W.newChat, W.search, T.kagiso, T.risk, T.docs, T.week, W.deleteAll];
    const tops: number[] = [];
    for (const n of names) tops.push((await rect(entry(page, n))).top);
    expect(tops, 'New chat, Search chats, the chats in order, then Delete all my chats').toEqual([...tops].sort((a, b) => a - b));
    expect(new Set(tops).size).toBe(tops.length);
    // The headings sit in order too.
    const heads = [group(page, W.today), group(page, W.yesterday), group(page, W.previous)];
    const headTops = [];
    for (const h of heads) headTops.push((await rect(h)).top);
    expect(headTops).toEqual([...headTops].sort((a, b) => a - b));
    // The app's own sidebar is not on this page.
    await expect(mainNav(page), 'the app’s sidebar is replaced on this page').toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Today', exact: true }), 'no sidebar item "Today"').toHaveCount(0);
    await expect(page.getByRole('link', { name: 'People', exact: true }), 'no sidebar item "People"').toHaveCount(0);
  });

  /** 23:30 in South Africa on 19 Nov; chats around midnight and further back. */
  const midnight = (): StoredChat[] => [
    chat(11, 'Just after midnight', sast('2026-11-19', '00:10')),
    chat(12, 'Just before midnight', sast('2026-11-18', '23:50')),
    chat(13, 'Two days ago', sast('2026-11-17', '12:00')),
    chat(14, 'A week ago', sast('2026-11-12', '12:00')),
    chat(15, 'Eight days ago', sast('2026-11-11', '12:00')),
    chat(18, 'First minutes of November', sast('2026-11-01', '00:30')),
    chat(16, 'Forty days ago', sast('2026-10-10', '12:00')),
    chat(17, 'Last year', sast('2025-12-05', '12:00')),
  ];
  const at2330 = new Date('2026-11-19T21:30:00Z');

  async function expectDays(page: Page): Promise<void> {
    await ensureList(page);
    await expect(rowsOf(group(page, W.today)), 'Today').toHaveCount(1);
    await expect(pick(group(page, W.today), 'Just after midnight')).toBeVisible();
    await expect(rowsOf(group(page, W.yesterday)), 'Yesterday').toHaveCount(1);
    await expect(pick(group(page, W.yesterday), 'Just before midnight')).toBeVisible();
    await expect(rowsOf(group(page, W.previous)), 'Previous 7 days: 2 to 7 days before today').toHaveCount(2);
    await expect(pick(group(page, W.previous), 'Two days ago')).toBeVisible();
    await expect(pick(group(page, W.previous), 'A week ago')).toBeVisible();
    await expect(pick(group(page, 'November 2026'), 'Eight days ago'), '8 days back is under its month').toBeVisible();
    await expect(pick(group(page, 'November 2026'), 'First minutes of November'), '00:30 on 1 November in South Africa is still 31 October in UTC: it sits under November').toBeVisible();
    await expect(rowsOf(group(page, 'November 2026'))).toHaveCount(2);
    await expect(pick(group(page, 'October 2026'), 'Forty days ago')).toBeVisible();
    await expect(pick(group(page, 'December 2025'), 'Last year')).toBeVisible();
    const tops: number[] = [];
    for (const g of [W.today, W.yesterday, W.previous, 'November 2026', 'October 2026', 'December 2025']) tops.push((await rect(group(page, g))).top);
    expect(tops, 'Today, Yesterday, Previous 7 days, then the months newest first').toEqual([...tops].sort((a, b) => a - b));
  }

  test('AC-2 Days and months follow South African time: at 23:30 a chat from 00:10 the same day is Today and one from 23:50 the day before is Yesterday; older chats sit under month and year, newest month first', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    await onFullPage({ page, signIn, hr, chats: chats! }, midnight(), at2330);
    await expectDays(page);
  });

  test.describe('in a browser far from South Africa', () => {
    test.use({ timezoneId: 'America/Los_Angeles' });
    test('AC-2 The same groups when the browser’s own time zone is Los Angeles (the day is South Africa’s, not the browser’s and not UTC)', async ({ page, signIn, hr, chats }) => {
      noBackendOnly();
      await onFullPage({ page, signIn, hr, chats: chats! }, midnight(), at2330);
      await expectDays(page);
    });
  });

  test('AC-3 Every page is read: 120 chats served 50 at a time all show, the reads stop when there is no nextToken, and a chat only on the third page is found by Search', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    const stored = MANY(119);
    stored.push(chat(900, 'Zulu payroll reconciliation', new Date(NOW.getTime() - 3 * 3600_000 - 119 * 1000 - 60_000)));
    c.seed(hr.email, stored);
    c.hold('list-next');
    await clockAt({ page, chats: c });
    await signedIn({ page, signIn, hr });
    await page.goto(FULL_PAGE);
    await ensureList(page);
    // What has arrived shows while the rest is still on its way.
    await expect(entry(page, 'Chat number 001'), 'the first page shows as soon as it arrives').toBeVisible();
    await expect(entry(page, 'Chat number 050')).toBeVisible();
    await expect.poll(() => c.of('list-next').length, { message: 'the second page was asked for' }).toBeGreaterThan(0);
    await expect(entry(page, 'Chat number 051'), 'the second page has not been answered yet').toHaveCount(0);
    c.release('list-next');
    await expect(rowsOf(group(page, W.today)), 'all 120 chats show').toHaveCount(120, { timeout: 20_000 });
    const reads = c.listReads();
    expect(reads.map((r) => r.url.searchParams.get('nextToken')), 'three reads: the first page, then each nextToken the server gave').toEqual([null, 'p50', 'p100']);
    await page.waitForTimeout(500);
    expect(c.listReads(), 'no read after the last page (no nextToken)').toHaveLength(3);
    // Search finds the chat that was only on the third page.
    await entry(page, W.search).click();
    await searchBox(page).fill('payroll');
    await expect(entry(page, 'Zulu payroll reconciliation')).toBeVisible();
    await expect(rowsOf(nav(page).getByRole('list', { name: W.today, exact: true }))).toHaveCount(1);
  });

  test('AC-3 The reads stop at 20 pages (1,000 chats) and Delete all my chats then does not name a number', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.pageSize = 50;
    await onFullPage({ page, signIn, hr, chats: c }, MANY(1100));
    await ensureList(page);
    await expect(entry(page, 'Chat number 001')).toBeVisible();
    await expect.poll(() => c.listReads().length, { timeout: 30_000 }).toBe(20);
    await page.waitForTimeout(800);
    expect(c.listReads(), 'never more than 20 pages').toHaveLength(20);
    await expect(rowsOf(group(page, W.today))).toHaveCount(1000);
    await entry(page, W.deleteAll).click();
    await expect(allDialog(page)).toBeVisible();
    await expect(allDialog(page), 'the number is not known: it stopped at 1,000').toContainText(W.allTextNoNumber);
    await expect(allDialog(page)).not.toContainText(/\b(1000|1,000|1100|1,100)\b/);
  });

  test('AC-4 With 60 chats the column scrolls on its own: Delete all my chats is reached by scrolling it, and nothing else moves', async ({ page, signIn, hr, chats }, info) => {
    desktopOnly(info.project.name);
    noBackendOnly();
    await onFullPage({ page, signIn, hr, chats: chats! }, MANY(60));
    await expect(entry(page, 'Chat number 060')).toBeAttached();
    const column = nav(page);
    const scrolls = await scroller(column);
    expect(scrolls, 'something in the column scrolls by itself').not.toBeNull();
    const own = scrolls!;
    const boxOf = page.getByRole('form', { name: 'Message Batsi' });
    const watch = async () => ({ back: await rect(backLink(page)), title: await rect(heading(page)), log: await rect(log(page)), logTop: await log(page).evaluate((e) => e.scrollTop), box: await rect(boxOf), win: await page.evaluate(() => window.scrollY) });
    const before = await watch();
    const pane = await rect(own);
    expect((await rect(entry(page, W.deleteAll))).bottom, 'Delete all my chats is past the end of what shows, before scrolling').toBeGreaterThan(pane.bottom + 0.5);
    await own.evaluate((e) => { e.scrollTop = e.scrollHeight; });
    await expect(entry(page, W.deleteAll)).toBeVisible();
    const last = await rect(entry(page, W.deleteAll));
    expect(last.bottom, 'Delete all my chats is now inside the column').toBeLessThanOrEqual((await rect(own)).bottom + 0.5);
    await expectOnScreen(page, entry(page, W.deleteAll), 'Delete all my chats');
    expect(await watch(), 'the window, Back to Today, the chat header, the conversation and the message box did not move').toEqual(before);
    const over = await pageDoesNotScroll(page);
    expect(over.window, 'the window has no scroll').toBeLessThanOrEqual(1);
    expect(over.main, 'the page area has no scroll').toBeLessThanOrEqual(1);
  });

  test('AC-4 Opening the list or a dialog does not change the size of the message box or the line under it', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    await onFullPage({ page, signIn, hr, chats: chats! });
    await open(page, T.docs);
    const boxOf = page.getByRole('form', { name: 'Message Batsi' });
    const before = await rect(boxOf);
    await ensureList(page);
    expect((await rect(boxOf)).height, 'the list opened: same height').toBeCloseTo(before.height, 0);
    await closeList(page);
    await headerDelete(page).click();
    await expect(oneDialog(page)).toBeVisible();
    expect((await rect(boxOf)).height, 'the dialog opened: same height').toBeCloseTo(before.height, 0);
    expect((await rect(boxOf)).width, 'and the same width').toBeCloseTo(before.width, 0);
  });
});

// ================================================================ AC-5, AC-6, AC-7, AC-8: open, ask, new

const LONG_TITLE = 'Onboarding checks for the new payroll team';
const LONG_MESSAGES: StoredMessage[] = [
  { role: 'person', text: 'Show me the open onboarding checks.', at: sast('2026-11-12', '15:12') },
  { role: 'batsi', text: 'Three people still have open checks.', at: sast('2026-11-12', '15:12') },
  { role: 'person', text: 'And who is blocked?', at: sast('2026-11-18', '15:12') },
  { role: 'batsi', text: 'Kagiso Molefe is waiting on a bank letter.', at: sast('2026-11-18', '15:12') },
  { role: 'person', text: 'Thanks, please note it.', at: sast('2026-11-19', '15:12') },
  { role: 'batsi', text: 'I have noted that for you.', at: sast('2026-11-19', '15:12') },
];
const WITH_LONG = (): StoredChat[] => [...FOUR(), chat(5, LONG_TITLE, sast('2026-11-19', '15:12'), LONG_MESSAGES)];

test.describe('Opening an old chat, asking in it, a new chat', () => {
  test('AC-5 Selecting a title reads that chat once: the heading is its title, the messages show in order with their times, no suggested questions, the item is current, focus is on the heading, Delete chat shows', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onFullPage({ page, signIn, hr, chats: c }, WITH_LONG());
    // A new chat first: no Delete chat there.
    await ensureList(page);
    await entry(page, LONG_TITLE).click();
    await expect(heading(page)).toHaveText(LONG_TITLE);
    const reads = c.of('open');
    expect(reads, 'one read of that chat').toHaveLength(1);
    expect(reads[0]!.path).toMatch(new RegExp(`/v1/chats/${chatId(5)}$`));
    expect(reads[0]!.method).toBe('GET');
    await expect(page, 'the address stays the same').toHaveURL(new RegExp(`${FULL_PAGE}$`));
    // The messages, in order.
    const l = log(page);
    const tops: number[] = [];
    for (const m of LONG_MESSAGES) { await expect(said(l, m.text)).toBeVisible(); tops.push((await rect(said(l, m.text))).top); }
    expect(tops, 'in order, oldest first').toEqual([...tops].sort((a, b) => a - b));
    // The person on the right, Batsi on the left.
    const mine = await rect(said(l, LONG_MESSAGES[0]!.text));
    const theirs = await rect(said(l, LONG_MESSAGES[1]!.text));
    expect(mine.right, 'the person’s message ends further right').toBeGreaterThan(theirs.right + 1);
    expect(theirs.left, 'Batsi’s message starts further left').toBeLessThan(mine.left + 1);
    // The times.
    await expect(said(l, '12 Nov 2026, 15:12'), 'older: day, month, year and time').toHaveCount(2);
    await expect(said(l, 'Yesterday 15:12')).toHaveCount(2);
    await expect(said(l, '15:12'), 'today: the time only').toHaveCount(2);
    // No suggested questions in an old chat; the greeting belongs to a new chat.
    await expect(l.getByRole('button', { name: T.risk, exact: true })).toHaveCount(0);
    await expect(l.getByRole('button', { name: T.docs, exact: true })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Tasks Batsi can do' })).toHaveCount(0);
    await expect(page.getByText(W.looking, { exact: true })).toBeVisible();
    // Current item, focus, Delete chat.
    await expect(heading(page), 'focus moves to the chat’s heading').toBeFocused();
    await ensureList(page);
    await expect(entry(page, LONG_TITLE)).toHaveAttribute('aria-current', 'page');
    await expect(entry(page, T.kagiso)).not.toHaveAttribute('aria-current', 'page');
    await closeList(page);
    await expect(headerDelete(page)).toBeVisible();
  });

  test('AC-5 A chat that is not stored yet has no Delete chat; opening one chat after another shows each its own messages', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onFullPage({ page, signIn, hr, chats: c }, WITH_LONG());
    await expect(headerDelete(page), 'a new chat has nothing to delete').toHaveCount(0);
    await open(page, LONG_TITLE);
    await expect(said(log(page), 'I have noted that for you.')).toBeVisible();
    await open(page, T.docs);
    await expect(said(log(page), `Answer to: ${T.docs}`)).toBeVisible();
    await expect(said(log(page), 'I have noted that for you.'), 'the first chat’s messages are gone').toHaveCount(0);
    expect(c.of('open').map((r) => r.chatId)).toEqual([chatId(5), chatId(3)]);
  });

  test('AC-6 A question asked in an old chat sends that chat’s id, the answer is added below the old messages, the list is read again and the chat moves to the top of Today', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.reply = () => 'This is the new answer.';
    await onFullPage({ page, signIn, hr, chats: c });
    await open(page, T.kagiso); // the older of the two chats today
    const readsBefore = c.listReads().length;
    await ask(page, 'And is he ready for Tuesday?');
    await expect(said(log(page), 'This is the new answer.')).toBeVisible();
    expect(c.asks(), 'one question').toHaveLength(1);
    expect(c.asks()[0]!.body.chatId, 'it carries the open chat’s id').toBe(chatId(1));
    expect(c.asks()[0]!.body.message).toBe('And is he ready for Tuesday?');
    const old = await rect(said(log(page), `Answer to: ${T.kagiso}`));
    const fresh = await rect(said(log(page), 'This is the new answer.'));
    expect(fresh.top, 'the answer is below the old messages').toBeGreaterThan(old.top);
    await expect.poll(() => c.listReads().length, { message: 'the list was read again after the answer' }).toBeGreaterThan(readsBefore);
    await ensureList(page);
    await expect(rowsOf(group(page, W.today)).first(), 'the chat moved to the top of Today').toHaveAccessibleName(T.kagiso);
    await expect(rowsOf(group(page, W.today))).toHaveCount(2);
  });

  test('AC-6 A chat that was deleted in another tab: the error line and Try again, the list is read again, and the next question starts a new chat', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.reply = () => 'A fresh answer.';
    await onFullPage({ page, signIn, hr, chats: c });
    await open(page, T.docs);
    c.deleteBehind(hr.email, chatId(3));
    const readsBefore = c.listReads().length;
    await ask(page, 'Anything else?');
    await expect(said(log(page), W.askError)).toBeVisible();
    await expect(log(page).getByRole('button', { name: W.retry, exact: true })).toBeVisible();
    expect(c.asks()[0]!.body.chatId, 'the question did carry the old id').toBe(chatId(3));
    await expect.poll(() => c.listReads().length, { message: 'the list was read again' }).toBeGreaterThan(readsBefore);
    await ensureList(page);
    await expect(entry(page, T.docs), 'the deleted chat dropped off the list').toHaveCount(0);
    if (isPhone(page)) await menuButton(page).click();
    await log(page).getByRole('button', { name: W.retry, exact: true }).click();
    await expect(said(log(page), 'A fresh answer.')).toBeVisible();
    expect(c.asks(), 'the retry was asked').toHaveLength(2);
    expect(c.asks()[1]!.body.chatId, 'the next question starts a new chat: no id').toBeUndefined();
    expect(c.lastCreated).not.toBeNull();
  });

  test('AC-7 New chat: the greeting, the suggested questions, the heading "New chat", no Delete chat, focus in the message box; nothing is sent', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onFullPage({ page, signIn, hr, chats: c });
    await open(page, T.docs);
    await expect(said(log(page), `Answer to: ${T.docs}`)).toBeVisible();
    const sent = c.calls.length;
    await ensureList(page);
    await entry(page, W.newChat).click();
    await expect(heading(page)).toHaveText(W.newChat);
    await expect(said(log(page), W.hello)).toBeVisible();
    await expect(log(page).getByRole('button', { name: T.risk, exact: true }), 'the suggested questions').toBeVisible();
    await expect(log(page).getByRole('button', { name: T.docs, exact: true })).toBeVisible();
    await expect(said(log(page), `Answer to: ${T.docs}`), 'the old chat’s messages are gone').toHaveCount(0);
    await expect(headerDelete(page)).toHaveCount(0);
    await expect(composer(page), 'focus is in the message box').toBeFocused();
    await expect(page.getByText(W.looking, { exact: true })).toBeVisible();
    expect(c.calls.slice(sent).filter((x) => x.route === 'ask' || x.route === 'delete-one' || x.route === 'delete-all'), 'nothing is sent by pressing New chat').toEqual([]);
    expect(c.asks(), 'no question yet').toHaveLength(0);
  });

  test('AC-7 The first question sends no chat id; the answer’s id goes with the second; the list is read again and shows the server’s title, never the typed words', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.titleFor = () => 'Documents still outstanding';
    c.reply = (q) => `Answer to ${q.length} characters.`;
    await onFullPage({ page, signIn, hr, chats: c });
    const typed = 'Who has not sent their documents??';
    const readsBefore = c.listReads().length;
    await ask(page, typed);
    await expect(said(log(page), `Answer to ${typed.length} characters.`)).toBeVisible();
    expect(c.asks()).toHaveLength(1);
    expect(c.asks()[0]!.body.chatId, 'the first question has no chat id').toBeUndefined();
    expect('chatId' in c.asks()[0]!.body, 'not even an empty one').toBe(false);
    await expect.poll(() => c.listReads().length, { message: 'the list was read again after the first answer' }).toBeGreaterThan(readsBefore);
    await ensureList(page);
    await expect(entry(page, 'Documents still outstanding'), 'the server’s title is in the list').toBeVisible();
    expect(await nav(page).innerText(), 'the typed words are not in the list').not.toContain('Who has not sent');
    if (isPhone(page)) await menuButton(page).click();
    await expect(headerDelete(page), 'the chat is stored now: Delete chat shows').toBeVisible();
    await ask(page, 'And their bank letters?');
    await expect(said(log(page), `Answer to ${'And their bank letters?'.length} characters.`)).toBeVisible();
    expect(c.asks()).toHaveLength(2);
    expect(c.asks()[1]!.body.chatId, 'the second question carries the id the first answer gave').toBe(c.lastCreated);
    expect(c.lastCreated).toMatch(/^[0-9A-Z]{26}$/);
  });

  test('AC-7 An answer without a chat id (AI off, a test login, the hourly limit) leaves the chat unsaved: no Delete chat, and the next question again sends none', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.mode.ask = 'nochatid';
    c.reply = () => 'Not saved.';
    await onFullPage({ page, signIn, hr, chats: c }, []);
    await ask(page, 'First question');
    await expect(said(log(page), 'Not saved.')).toBeVisible();
    await ask(page, 'Second question');
    await expect(said(log(page), 'Not saved.')).toHaveCount(2);
    expect(c.asks().map((a) => 'chatId' in a.body), 'no chat id on either').toEqual([false, false]);
    await expect(headerDelete(page)).toHaveCount(0);
  });

  test('AC-8 One chat in the panel and on the page: an old chat opened on the page is there in the panel, a question in the panel sends its id, and Open as a full page shows it with its item current; the panel has no list and no delete', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.reply = () => 'Answered in the panel.';
    await onFullPage({ page, signIn, hr, chats: c });
    await open(page, T.docs);
    await expect(said(log(page), `Answer to: ${T.docs}`)).toBeVisible();
    await backLink(page).click();
    await expect(page).toHaveURL(/\/hr$/);
    await askButton(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(said(panel(page).getByRole('log'), `Answer to: ${T.docs}`), 'the panel shows that chat').toBeVisible();
    await expect(nav(page), 'the panel has no list').toHaveCount(0);
    for (const n of [W.deleteChat, W.deleteAll, W.newChat, W.search]) await expect(panel(page).getByRole('button', { name: n, exact: true }), `the panel has no "${n}"`).toHaveCount(0);
    await composer(page).fill('One more thing');
    await sendButton(page).click();
    await expect(said(panel(page).getByRole('log'), 'Answered in the panel.')).toBeVisible();
    expect(c.asks()[0]!.body.chatId, 'a question in the panel sends the chat’s id').toBe(chatId(3));
    await panel(page).getByRole('button', { name: 'Open as a full page', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${FULL_PAGE}$`));
    await expect(panel(page)).toHaveCount(0);
    await expect(heading(page)).toHaveText(T.docs);
    await expect(said(log(page), 'Answered in the panel.')).toBeVisible();
    await ensureList(page);
    await expect(entry(page, T.docs)).toHaveAttribute('aria-current', 'page');
  });
});

// ================================================================ AC-9, AC-10, AC-11: deleting

test.describe('Delete chat', () => {
  test('AC-9 Delete chat asks first with the approved words, focus is on Cancel, and Cancel, Close and Escape each send nothing and return focus to Delete chat', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onFullPage({ page, signIn, hr, chats: c });
    await open(page, T.docs);
    for (const how of ['Cancel', 'Close', 'Escape'] as const) {
      await headerDelete(page).click();
      const dialog = oneDialog(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: W.oneTitle, exact: true })).toBeVisible();
      await expect(said(dialog, W.oneText)).toBeVisible();
      await expect(dialog).toHaveAccessibleDescription(W.oneText);
      await expect(dialog.getByRole('button', { name: W.cancel, exact: true })).toBeVisible();
      await expect(confirmButton(dialog, false)).toBeVisible();
      await expect(dialog.getByRole('button', { name: W.close, exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: W.cancel, exact: true }), 'focus starts on the safe choice').toBeFocused();
      if (how === 'Cancel') await dialog.getByRole('button', { name: W.cancel, exact: true }).click();
      else if (how === 'Close') await dialog.getByRole('button', { name: W.close, exact: true }).click();
      else await page.keyboard.press('Escape');
      await expect(dialog, `${how} closes it`).toHaveCount(0);
      await expect(headerDelete(page), `${how}: focus returns to Delete chat`).toBeFocused();
    }
    expect(c.of('delete-one').concat(c.of('delete-all')), 'nothing was sent').toEqual([]);
  });

  test('AC-9 Delete chat sends one DELETE for this chat (a double press sends one), then the dialog closes, the title is gone from the list, the view is New chat and focus is in the message box', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onFullPage({ page, signIn, hr, chats: c });
    await open(page, T.docs);
    const readsBefore = c.listReads().length;
    await headerDelete(page).click();
    const dialog = oneDialog(page);
    c.hold('delete-one');
    // Two presses in the same moment: the second must change nothing.
    await confirmButton(dialog, false).evaluate((b) => { (b as HTMLButtonElement).click(); (b as HTMLButtonElement).click(); });
    await expect.poll(() => c.of('delete-one').length, { message: 'the request arrived' }).toBeGreaterThan(0);
    await page.waitForTimeout(250);
    await expect.poll(() => confirmButton(dialog, false).evaluate((b) => b.getAttribute('aria-busy') === 'true' || (b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true' || !!b.querySelector('.pp-spinner')), { message: 'the button shows it is busy' }).toBe(true);
    c.hold('list');
    c.release('delete-one');
    await expect(dialog, 'the dialog closes').toHaveCount(0);
    expect(c.of('delete-one'), 'exactly one DELETE').toHaveLength(1);
    expect(c.of('delete-one')[0]!.method).toBe('DELETE');
    expect(c.of('delete-one')[0]!.path).toMatch(new RegExp(`/v1/chats/${chatId(3)}$`));
    expect(c.of('delete-all'), 'and not the other one').toEqual([]);
    await expect(heading(page)).toHaveText(W.newChat);
    await expect(said(log(page), W.hello)).toBeVisible();
    await expect(composer(page), 'focus goes to the message box').toBeFocused();
    await ensureList(page);
    await expect(entry(page, T.docs), 'the title is gone at once, before the list is read again').toHaveCount(0);
    c.release('list');
    await expect.poll(() => c.listReads().length, { message: 'the list is read again after a delete' }).toBeGreaterThan(readsBefore);
    await ensureList(page);
    await expect(entry(page, T.docs), 'the title is gone from the list').toHaveCount(0);
    await expect(entry(page, T.kagiso)).toBeVisible();
  });

  test('AC-9 An answer of 404 (the chat was already deleted somewhere else) counts as done', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onFullPage({ page, signIn, hr, chats: c });
    await open(page, T.docs);
    c.deleteBehind(hr.email, chatId(3));
    c.script('delete-one', 'notfound');
    await headerDelete(page).click();
    await confirmButton(oneDialog(page), false).click();
    await expect(oneDialog(page)).toHaveCount(0);
    await expect(heading(page)).toHaveText(W.newChat);
    await ensureList(page);
    await expect(entry(page, T.docs)).toHaveCount(0);
    await expect(oneDialog(page), 'no failure line').toHaveCount(0);
  });
});

test.describe('Delete all my chats', () => {
  test('AC-10 With 4 chats the dialog says how many; Cancel, Close and Escape send nothing; confirming sends one DELETE of all, the list is empty, Delete all my chats is gone and the view is New chat', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onFullPage({ page, signIn, hr, chats: c });
    await open(page, T.docs);
    for (const how of ['Cancel', 'Close', 'Escape'] as const) {
      await ensureList(page);
      await entry(page, W.deleteAll).click();
      const dialog = allDialog(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: W.allTitle, exact: true })).toBeVisible();
      await expect(said(dialog, W.allText(4))).toBeVisible();
      await expect(dialog).toHaveAccessibleDescription(W.allText(4));
      await expect(dialog.getByRole('button', { name: W.cancel, exact: true })).toBeFocused();
      await expect(confirmButton(dialog, true)).toBeVisible();
      await expect(dialog.getByRole('button', { name: W.close, exact: true })).toBeVisible();
      if (how === 'Cancel') await dialog.getByRole('button', { name: W.cancel, exact: true }).click();
      else if (how === 'Close') await dialog.getByRole('button', { name: W.close, exact: true }).click();
      else await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(entry(page, W.deleteAll), `${how}: focus returns to Delete all my chats`).toBeFocused();
    }
    expect(c.of('delete-all').concat(c.of('delete-one')), 'nothing was sent').toEqual([]);
    await entry(page, W.deleteAll).click();
    await confirmButton(allDialog(page), true).click();
    await expect(allDialog(page)).toHaveCount(0);
    expect(c.of('delete-all'), 'exactly one DELETE').toHaveLength(1);
    expect(c.of('delete-all')[0]!.method).toBe('DELETE');
    expect(c.of('delete-all')[0]!.path, 'the path of the list itself, no id').toMatch(/\/v1\/chats$/);
    expect(c.of('delete-one')).toEqual([]);
    await expect(heading(page)).toHaveText(W.newChat);
    await expect(composer(page), 'focus goes to the message box').toBeFocused();
    await ensureList(page);
    await expect(entry(page, W.deleteAll), 'no Delete all my chats once the list is empty').toHaveCount(0);
    for (const t of [T.kagiso, T.risk, T.docs, T.week]) await expect(entry(page, t)).toHaveCount(0);
    await expect(nav(page).getByRole('list', { name: /.+/ }), 'no group is left').toHaveCount(0);
    expect(c.stored(hr.email)).toEqual([]);
  });

  test('AC-10 With one chat the dialog does not name a number (W14-1)', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    await onFullPage({ page, signIn, hr, chats: chats! }, [FOUR()[0]!]);
    await ensureList(page);
    await entry(page, W.deleteAll).click();
    await expect(allDialog(page)).toBeVisible();
    await expect(said(allDialog(page), W.allTextNoNumber)).toBeVisible();
    await expect(allDialog(page)).not.toContainText(/\b1 of\b/);
  });

  test('AC-10 With a search open that shows fewer chats, the dialog still says "all 4" (the whole list, not what the search shows)', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    await onFullPage({ page, signIn, hr, chats: chats! });
    await ensureList(page);
    await entry(page, W.search).click();
    await searchBox(page).fill('kagiso');
    await expect(rowsOf(nav(page)).filter({ hasText: 'Kagiso' })).toHaveCount(1);
    await expect(entry(page, T.docs)).toHaveCount(0);
    await entry(page, W.deleteAll).click();
    await expect(said(allDialog(page), W.allText(4))).toBeVisible();
  });

  test('AC-10 With two chats the dialog says "all 2 of your chats"', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    await onFullPage({ page, signIn, hr, chats: chats! }, FOUR().slice(0, 2));
    await ensureList(page);
    await entry(page, W.deleteAll).click();
    await expect(said(allDialog(page), W.allText(2))).toBeVisible();
  });
});

test.describe('A delete that fails', () => {
  const FAILURES: Array<['failed' | 'dropped' | 'offline', string]> = [
    ['failed', 'the server answers 500'],
    ['dropped', 'the connection drops'],
    ['offline', 'the browser is offline'],
  ];

  test('AC-11 Delete chat: for an error answer, a dropped connection and offline the dialog stays open with the failure line, nothing changes, and pressing again sends one more request', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onFullPage({ page, signIn, hr, chats: c });
    await open(page, T.docs);
    await headerDelete(page).click();
    const dialog = oneDialog(page);
    let sent = 0;
    for (const [mode, why] of FAILURES) {
      c.mode['delete-one'] = mode;
      await confirmButton(dialog, false).click();
      sent++;
      await expect.poll(() => c.of('delete-one').length, { message: `${why}: the request was sent` }).toBe(sent);
      await expect(dialog.getByRole('alert'), `${why}: the failure line is in the dialog`).toHaveText(W.failed);
      await expect(dialog, `${why}: the dialog stays open`).toBeVisible();
      await expect(confirmButton(dialog, false), `${why}: the button works again`).toBeEnabled();
      expect(await dialog.innerText(), 'no status code or error text').not.toMatch(/\b(500|502|403|404)\b|Something went wrong|0xDEAD|internal failure|ERR_|Failed to fetch|NetworkError/i);
    }
    expect(c.of('delete-one'), 'one more request for each press').toHaveLength(3);
    await dialog.getByRole('button', { name: W.cancel, exact: true }).click();
    await expect(heading(page), 'the open chat is unchanged').toHaveText(T.docs);
    await expect(said(log(page), `Answer to: ${T.docs}`)).toBeVisible();
    await ensureList(page);
    for (const t of [T.kagiso, T.risk, T.docs, T.week]) await expect(entry(page, t), 'the list is unchanged').toBeVisible();
    expect(c.stored(hr.email)).toHaveLength(4);
  });

  test('AC-11 Delete all my chats: the same three failures, the same line, nothing changes', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onFullPage({ page, signIn, hr, chats: c });
    await ensureList(page);
    await entry(page, W.deleteAll).click();
    const dialog = allDialog(page);
    let sent = 0;
    for (const [mode, why] of FAILURES) {
      c.mode['delete-all'] = mode;
      await confirmButton(dialog, true).click();
      sent++;
      await expect.poll(() => c.of('delete-all').length, { message: `${why}: the request was sent` }).toBe(sent);
      await expect(dialog.getByRole('alert'), `${why}: the failure line is in the dialog`).toHaveText(W.failed);
      await expect(dialog).toBeVisible();
      await expect(confirmButton(dialog, true)).toBeEnabled();
      expect(await dialog.innerText()).not.toMatch(/\b(500|502|403|404)\b|Something went wrong|0xDEAD|internal failure|ERR_|Failed to fetch|NetworkError/i);
    }
    expect(c.of('delete-all')).toHaveLength(3);
    await dialog.getByRole('button', { name: W.cancel, exact: true }).click();
    await ensureList(page);
    for (const t of [T.kagiso, T.risk, T.docs, T.week]) await expect(entry(page, t)).toBeVisible();
    await expect(entry(page, W.deleteAll)).toBeVisible();
    expect(c.stored(hr.email)).toHaveLength(4);
  });
});

// ================================================================ AC-12 to AC-16: states

test.describe('Empty, loading, failing and switched off', () => {
  test('AC-12 An empty list: Back to Today, New chat and Search chats only; no group heading, no Delete all my chats, no error line; the view is New chat', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onFullPage({ page, signIn, hr, chats: c }, []);
    await expect.poll(() => c.listReads().length).toBeGreaterThan(0);
    await ensureList(page);
    if (!isPhone(page)) await expect(backLink(page)).toBeVisible();
    await expect(entry(page, W.newChat)).toBeVisible();
    await expect(entry(page, W.search)).toBeVisible();
    await expect(nav(page).getByRole('list', { name: /.+/ }), 'no group heading').toHaveCount(0);
    await expect(entry(page, W.deleteAll)).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText(W.loadFailed)).toHaveCount(0);
    await expect(page.getByText(W.noMatch), 'an empty list has no sentence: “No chats found.” is only for a search with no match').toHaveCount(0);
    await expect(nav(page).locator('[aria-busy="true"]')).toHaveCount(0);
    if (isPhone(page)) await menuButton(page).click();
    await expect(heading(page)).toHaveText(W.newChat);
    await expect(said(log(page), W.hello)).toBeVisible();
  });

  test('AC-13 While the list has not answered: loading rows with no words, aria-busy, no titles and no headings; a question can still be asked and answered', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.reply = () => 'Answered meanwhile.';
    c.hold('list');
    c.seed(hr.email, FOUR());
    await clockAt({ page, chats: c });
    await signedIn({ page, signIn, hr });
    await page.goto(FULL_PAGE);
    await expect.poll(() => c.of('list').length, { message: 'the list was asked for' }).toBe(1);
    await ensureList(page);
    await expect(nav(page).locator('[aria-busy="true"]').or(nav(page).and(page.locator('[aria-busy="true"]'))), 'the list is marked busy').not.toHaveCount(0);
    for (const t of [T.kagiso, T.risk, T.docs, T.week]) await expect(entry(page, t)).toHaveCount(0);
    await expect(nav(page).getByRole('list', { name: /.+/ }), 'no group headings').toHaveCount(0);
    const words = (await nav(page).innerText()).split('\n').map((s) => s.trim()).filter(Boolean);
    expect(words.filter((w) => ![W.back, W.newChat, W.search, W.chats].includes(w)), 'the loading rows carry no words').toEqual([]);
    if (isPhone(page)) await menuButton(page).click();
    await expect(heading(page)).toHaveText(W.newChat);
    await ask(page, 'A question while the list loads');
    await expect(said(log(page), 'Answered meanwhile.')).toBeVisible();
    c.release('list');
    await ensureList(page);
    await expect(entry(page, T.kagiso)).toBeVisible();
    await expect(nav(page).locator('[aria-busy="true"]')).toHaveCount(0);
  });

  const LIST_FAILS: Array<['failed' | 'dropped' | 'nolist', string]> = [
    ['failed', 'a 500'],
    ['dropped', 'a dropped connection'],
    ['nolist', 'a 200 without a chats list'],
  ];
  for (const [mode, why] of LIST_FAILS) {
    test(`AC-14 The list fails (${why}): the line and Try again; Try again reads once more and then shows the list; Delete all my chats is there and says it without a number; asking still works`, async ({ page, signIn, hr, chats }) => {
      noBackendOnly();
      const c = chats!;
      c.reply = () => 'Still working.';
      c.mode.list = mode;
      await onFullPage({ page, signIn, hr, chats: c });
      await ensureList(page);
      await expect(nav(page).getByText(W.loadFailed, { exact: true })).toBeVisible();
      await expect(nav(page).getByRole('alert')).toHaveText(W.loadFailed);
      await expect(nav(page).getByRole('button', { name: W.retry, exact: true }).or(nav(page).getByRole('link', { name: W.retry, exact: true }))).toBeVisible();
      await expect(entry(page, W.newChat)).toBeVisible();
      await expect(entry(page, W.search)).toBeVisible();
      await expect(entry(page, W.deleteAll), 'the person may still have chats').toBeVisible();
      expect(await screenText(page), 'no status code or error text').not.toMatch(/\b(500|502|403|404)\b|Something went wrong|0xDEAD|internal failure|ERR_|Failed to fetch|NetworkError|undefined|\[object/i);
      // Delete all my chats does not know how many.
      await entry(page, W.deleteAll).click();
      await expect(said(allDialog(page), W.allTextNoNumber)).toBeVisible();
      await allDialog(page).getByRole('button', { name: W.cancel, exact: true }).click();
      await expect(allDialog(page)).toHaveCount(0);
      // Asking still works.
      await ensureList(page);
      const before = c.listReads().length;
      c.mode.list = 'ok';
      await nav(page).getByRole('button', { name: W.retry, exact: true }).or(nav(page).getByRole('link', { name: W.retry, exact: true })).click();
      await expect(entry(page, T.kagiso), 'after Try again the list shows').toBeVisible();
      expect(c.listReads().length, 'Try again made one new read').toBe(before + 1);
      await expect(nav(page).getByText(W.loadFailed)).toHaveCount(0);
      if (isPhone(page)) await menuButton(page).click();
      await ask(page, 'Does asking work?');
      await expect(said(log(page), 'Still working.')).toBeVisible();
    });
  }

  test('AC-14 With the list failing, a question is still asked and answered', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.reply = () => 'Answered anyway.';
    c.mode.list = 'failed';
    await onFullPage({ page, signIn, hr, chats: c });
    await ask(page, 'Can I still ask?');
    await expect(said(log(page), 'Answered anyway.')).toBeVisible();
    expect(c.asks()).toHaveLength(1);
  });

  test('AC-15 An old chat that fails to open (500): the line and Try again, no Delete chat, the item stays current; Try again reads once more and then shows the chat', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onFullPage({ page, signIn, hr, chats: c });
    c.script('open', 'failed');
    await ensureList(page);
    await entry(page, T.docs).click();
    await expect(log(page).getByText(W.openFailed, { exact: true })).toBeVisible();
    await expect(log(page).getByRole('alert')).toHaveText(W.openFailed);
    await expect(log(page).getByRole('button', { name: W.retry, exact: true })).toBeVisible();
    await expect(headerDelete(page)).toHaveCount(0);
    expect(await screenText(page)).not.toMatch(/\b(500|502|403|404)\b|Something went wrong|0xDEAD|internal failure/i);
    await ensureList(page);
    await expect(entry(page, T.docs), 'the item stays current').toHaveAttribute('aria-current', 'page');
    if (isPhone(page)) await menuButton(page).click();
    const before = c.of('open').length;
    await log(page).getByRole('button', { name: W.retry, exact: true }).click();
    await expect(said(log(page), `Answer to: ${T.docs}`)).toBeVisible();
    expect(c.of('open').length, 'one new read').toBe(before + 1);
    await expect(heading(page)).toHaveText(T.docs);
    await expect(headerDelete(page)).toBeVisible();
  });

  test('AC-15 An old chat that is gone (404): the list is read again, the title is gone and the view is New chat', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onFullPage({ page, signIn, hr, chats: c });
    await ensureList(page);
    await expect(entry(page, T.docs), 'the list has loaded with the chat in it').toBeVisible();
    c.deleteBehind(hr.email, chatId(3));
    const readsBefore = c.listReads().length;
    await entry(page, T.docs).click();
    await expect.poll(() => c.listReads().length, { message: 'the list was read again' }).toBeGreaterThan(readsBefore);
    await ensureList(page);
    await expect(entry(page, T.docs)).toHaveCount(0);
    if (isPhone(page)) await menuButton(page).click();
    await expect(heading(page)).toHaveText(W.newChat);
    await expect(said(log(page), W.hello)).toBeVisible();
    await expect(page.getByText(W.openFailed)).toHaveCount(0);
  });

  test('AC-16 Switched off (403 on the list): only Back to Today and Delete all my chats in the column, the not-switched-on message at once without a question, the message box off, nothing asked', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.on = false;
    await onFullPage({ page, signIn, hr, chats: c });
    await expect.poll(() => c.listReads().length).toBeGreaterThan(0);
    await expect(said(log(page), W.notOn)).toBeVisible();
    await expect(said(log(page), W.notOnNext)).toBeVisible();
    await expect(composer(page), 'the message box is off').toBeDisabled();
    expect(c.asks(), 'no question was sent').toEqual([]);
    await ensureList(page);
    if (!isPhone(page)) await expect(backLink(page)).toBeVisible();
    await expect(entry(page, W.deleteAll)).toBeVisible();
    await expect(entry(page, W.newChat), 'no New chat').toHaveCount(0);
    await expect(entry(page, W.search), 'no Search chats').toHaveCount(0);
    await expect(nav(page).getByRole('list', { name: /.+/ }), 'no titles or groups').toHaveCount(0);
    await expect(nav(page).getByRole('alert'), 'switched off is not a failure to load').toHaveCount(0);
    await expect(page.getByText(W.loadFailed)).toHaveCount(0);
  });

  test('AC-16 Switched off: Delete all my chats still works, with W14-1 and one DELETE, and is gone after the 200', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.on = false;
    await onFullPage({ page, signIn, hr, chats: c });
    await ensureList(page);
    await entry(page, W.deleteAll).click();
    await expect(allDialog(page)).toBeVisible();
    await expect(said(allDialog(page), W.allTextNoNumber)).toBeVisible();
    await confirmButton(allDialog(page), true).click();
    await expect(allDialog(page)).toHaveCount(0);
    expect(c.of('delete-all')).toHaveLength(1);
    expect(c.stored(hr.email)).toEqual([]);
    await ensureList(page);
    await expect(entry(page, W.deleteAll), 'no longer shown').toHaveCount(0);
    await expect(said(log(page), W.notOn), 'still switched off').toBeVisible();
  });
});

// ================================================================ AC-17: search

test.describe('Search chats', () => {
  test('AC-17 Search chats opens a labelled box with focus in it; typing filters titles in any case across groups and hides empty groups; nothing is sent while typing; no match says so; Escape closes it, shows the whole list and returns focus to Search chats', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    const stored = [
      chat(21, 'Is Kagiso ready to start on Monday?', sast('2026-11-19', '15:40')),
      chat(22, 'Which candidates are at risk?', sast('2026-11-19', '09:05')),
      chat(23, 'Who hasn’t sent their documents?', sast('2026-11-18', '15:12')),
      chat(24, 'Ask Kagiso for his UIF reference number', sast('2026-11-14', '10:30')),
      chat(25, 'Headcount for October', sast('2026-10-10', '10:30')),
    ];
    await onFullPage({ page, signIn, hr, chats: c }, stored);
    await ensureList(page);
    await expect(searchBox(page)).toHaveCount(0);
    await entry(page, W.search).click();
    const box = searchBox(page);
    await expect(box).toBeVisible();
    await expect(box, 'focus is in the box').toBeFocused();
    const calls = c.calls.length;
    await box.pressSequentially('KAGISO');
    await expect(entry(page, 'Is Kagiso ready to start on Monday?')).toBeVisible();
    await expect(entry(page, 'Ask Kagiso for his UIF reference number'), 'in another group').toBeVisible();
    for (const t of ['Which candidates are at risk?', 'Who hasn’t sent their documents?', 'Headcount for October']) await expect(entry(page, t), 'does not match').toHaveCount(0);
    await expect(group(page, W.today)).toBeVisible();
    await expect(group(page, W.previous)).toBeVisible();
    await expect(group(page, W.yesterday), 'a group with no match is hidden').toHaveCount(0);
    await expect(group(page, 'October 2026'), 'and so is a month with no match').toHaveCount(0);
    expect(c.calls.length, 'no request while typing').toBe(calls);
    await box.fill('zzz');
    await expect(said(nav(page), W.noMatch)).toBeVisible();
    await expect(nav(page).getByRole('status')).toContainText(W.noMatch);
    await expect(nav(page).getByRole('list', { name: /.+/ })).toHaveCount(0);
    expect(c.calls.length, 'still no request').toBe(calls);
    await page.keyboard.press('Escape');
    await expect(searchBox(page), 'Escape closes the search').toHaveCount(0);
    for (const s of stored) await expect(entry(page, s.title), 'the whole list is back').toBeVisible();
    await expect(said(nav(page), W.noMatch)).toHaveCount(0);
    await expect(entry(page, W.search), 'focus is back on Search chats').toBeFocused();
  });

  test('AC-17 Emptying the box and leaving it also closes the search and shows the whole list', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    await onFullPage({ page, signIn, hr, chats: chats! });
    await ensureList(page);
    await entry(page, W.search).click();
    await searchBox(page).fill('risk');
    await expect(entry(page, T.kagiso)).toHaveCount(0);
    await searchBox(page).fill('');
    await entry(page, W.newChat).focus();
    await expect(searchBox(page)).toHaveCount(0);
    for (const t of [T.kagiso, T.risk, T.docs, T.week]) await expect(entry(page, t)).toBeVisible();
  });
});

// ================================================================ AC-18, AC-19: phone

test.describe('Phone', () => {
  test('AC-18 On the full page the header shows the arrow link Back to Today, the title and Delete chat, all on screen and clear of the top bar; the menu button opens the list headed "Chats"; choosing a chat closes it and shows that chat; no sideways scroll; the message box is above the bottom edge', async ({ page, signIn, hr, chats }, info) => {
    phoneOnly(info.project.name);
    noBackendOnly();
    await onFullPage({ page, signIn, hr, chats: chats! });
    // A new chat: the title "New chat", the arrow, no Delete chat.
    await expectClearOfTopBar(page, backLink(page), 'Back to Today');
    await expect(backLink(page), 'exactly one link named Back to Today').toHaveCount(1);
    await expectClearOfTopBar(page, heading(page), 'the heading');
    expect(await listShown(page), 'the list is behind the menu button').toBe(false);
    await menuButton(page).click();
    await expect.poll(() => listShown(page), { message: 'the menu button opened the list' }).toBe(true);
    await expect(page.getByRole('heading', { name: W.chats, exact: true })).toBeVisible();
    await expectClearOfTopBar(page, page.getByRole('heading', { name: W.chats, exact: true }), 'the Chats heading');
    for (const n of [W.newChat, W.search, T.kagiso, T.risk, T.docs, T.week, W.deleteAll]) await expectClearOfTopBar(page, entry(page, n), n);
    await entry(page, T.docs).click();
    await expect.poll(() => listShown(page), { message: 'choosing a chat closes the list' }).toBe(false);
    await expect(heading(page)).toHaveText(T.docs);
    await expectClearOfTopBar(page, backLink(page), 'Back to Today');
    await expect(backLink(page)).toHaveCount(1);
    await expectClearOfTopBar(page, heading(page), 'the chat title');
    await expectClearOfTopBar(page, headerDelete(page), 'Delete chat');
    await expect(said(log(page), `Answer to: ${T.docs}`)).toBeVisible();
    const sideways = await page.evaluate(() => { const d = document.scrollingElement!; return d.scrollWidth - d.clientWidth; });
    expect(sideways, 'no sideways scroll').toBeLessThanOrEqual(0);
    const box = page.getByRole('form', { name: 'Message Batsi' });
    const { h } = await viewport(page);
    expect((await rect(box)).bottom, 'the message box is above the bottom edge of the screen').toBeLessThanOrEqual(h + 0.5);
    await expectOnScreen(page, composer(page), 'the box to type in');
    await expectOnScreen(page, sendButton(page), 'Send');
    // New chat from the list also closes it.
    await menuButton(page).click();
    await entry(page, W.newChat).click();
    await expect.poll(() => listShown(page), { message: 'New chat closes the list' }).toBe(false);
    await expect(heading(page)).toHaveText(W.newChat);
    await expectClearOfTopBar(page, heading(page), 'the New chat heading');
  });

  test('AC-19 Both delete dialogs fit the screen: the title, the text, Cancel and the delete button are inside it and not under the top bar', async ({ page, signIn, hr, chats }, info) => {
    phoneOnly(info.project.name);
    noBackendOnly();
    await onFullPage({ page, signIn, hr, chats: chats! });
    await open(page, T.docs);
    await headerDelete(page).click();
    let d = oneDialog(page);
    await expect(d).toBeVisible();
    for (const [what, l] of [
      ['the title', d.getByRole('heading', { name: W.oneTitle, exact: true })],
      ['the text', said(d, W.oneText)],
      ['Cancel', d.getByRole('button', { name: W.cancel, exact: true })],
      ['Delete chat', confirmButton(d, false)],
    ] as Array<[string, Locator]>) {
      await expectOnScreen(page, l, what);
      await expectNotCovered(l, what);
    }
    const bar = await rect(topBar(page));
    expect((await rect(d)).top, 'the dialog is not under the top bar').toBeGreaterThanOrEqual(Math.min(bar.bottom, 0) - 0.5);
    await d.getByRole('button', { name: W.cancel, exact: true }).click();
    await menuButton(page).click();
    await entry(page, W.deleteAll).click();
    d = allDialog(page);
    await expect(d).toBeVisible();
    for (const [what, l] of [
      ['the title', d.getByRole('heading', { name: W.allTitle, exact: true })],
      ['the text', said(d, W.allText(4))],
      ['Cancel', d.getByRole('button', { name: W.cancel, exact: true })],
      ['Delete all my chats', confirmButton(d, true)],
    ] as Array<[string, Locator]>) {
      await expectOnScreen(page, l, what);
      await expectNotCovered(l, what);
    }
  });
});

// ================================================================ AC-20, AC-21: keyboard and screen reader

const nameOfFocus = (page: Page): Promise<string> => page.evaluate(() => {
  const e = document.activeElement as HTMLElement | null;
  return ((e?.getAttribute('aria-label') ?? e?.textContent) ?? '').replace(/\s+/g, ' ').trim();
});

test.describe('Keyboard', () => {
  test('AC-20 From Back to Today, Tab reaches New chat, Search chats, each title in order and Delete all my chats; Enter on a title opens it', async ({ page, signIn, hr, chats }, info) => {
    desktopOnly(info.project.name);
    noBackendOnly();
    await onFullPage({ page, signIn, hr, chats: chats! });
    await expect(entry(page, T.week)).toBeVisible();
    await backLink(page).focus();
    for (const expected of [W.newChat, W.search, T.kagiso, T.risk, T.docs, T.week, W.deleteAll]) {
      await page.keyboard.press('Tab');
      expect(await nameOfFocus(page), `Tab reaches ${expected}`).toContain(expected);
    }
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('nav[aria-label="Chats"]')), 'after the list, Tab leaves the column (to the chat header, the conversation, the message box)').toBe(false);
    await entry(page, T.docs).focus();
    await page.keyboard.press('Enter');
    await expect(heading(page)).toHaveText(T.docs);
    await expect(entry(page, T.docs)).toHaveAttribute('aria-current', 'page');
  });

  test('AC-20 Deleting a chat by keyboard alone: Enter on Delete chat, focus stays inside the dialog while it is open, Escape returns to Delete chat, and Enter on the red button deletes', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onFullPage({ page, signIn, hr, chats: c });
    await open(page, T.docs);
    await headerDelete(page).focus();
    await page.keyboard.press('Enter');
    await expect(oneDialog(page)).toBeVisible();
    await expect(oneDialog(page).getByRole('button', { name: W.cancel, exact: true })).toBeFocused();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"], [role="alertdialog"]')), `Tab ${i + 1}: focus is still inside the dialog`).toBe(true);
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"], [role="alertdialog"]')), `Shift+Tab ${i + 1}: focus is still inside the dialog`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(oneDialog(page)).toHaveCount(0);
    await expect(headerDelete(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(oneDialog(page)).toBeVisible();
    for (let i = 0; i < 6 && (await nameOfFocus(page)) !== W.deleteChat; i++) await page.keyboard.press('Tab');
    expect(await nameOfFocus(page), 'the red button is reached by Tab').toBe(W.deleteChat);
    await page.keyboard.press('Enter');
    await expect(oneDialog(page)).toHaveCount(0);
    expect(c.of('delete-one')).toHaveLength(1);
    await expect(heading(page)).toHaveText(W.newChat);
  });

  test('AC-20 Deleting all chats by keyboard alone, and the search by keyboard: Enter opens the dialog, the red button deletes, Enter on Search chats opens the box', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onFullPage({ page, signIn, hr, chats: c });
    await ensureList(page);
    await entry(page, W.search).focus();
    await page.keyboard.press('Enter');
    await expect(searchBox(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(searchBox(page)).toHaveCount(0);
    await entry(page, W.deleteAll).focus();
    await page.keyboard.press('Enter');
    await expect(allDialog(page)).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"], [role="alertdialog"]'))).toBe(true);
    }
    for (let i = 0; i < 6 && (await nameOfFocus(page)) !== W.deleteAll; i++) await page.keyboard.press('Tab');
    expect(await nameOfFocus(page)).toBe(W.deleteAll);
    await page.keyboard.press('Enter');
    await expect(allDialog(page)).toHaveCount(0);
    expect(c.of('delete-all')).toHaveLength(1);
  });
});

test.describe('Screen reader names', () => {
  test('AC-21 A navigation landmark named Chats, each group’s list named by its heading, the open item marked current, the dialogs named by their titles and described by their text', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    await onFullPage({ page, signIn, hr, chats: chats! });
    await open(page, T.docs);
    await ensureList(page);
    await expect(page.getByRole('navigation', { name: W.chats, exact: true })).toHaveCount(1);
    for (const g of [W.today, W.yesterday, W.previous]) await expect(page.getByRole('list', { name: g, exact: true }), `the list named "${g}"`).toBeVisible();
    await expect(page.getByRole('list', { name: W.yesterday, exact: true }).getByRole('link', { name: T.docs, exact: true }).or(page.getByRole('list', { name: W.yesterday, exact: true }).getByRole('button', { name: T.docs, exact: true }))).toHaveAttribute('aria-current', 'page');
    await expect(nav(page).locator('[aria-current="page"]'), 'only one item is current').toHaveCount(1);
    if (isPhone(page)) await menuButton(page).click();
    await headerDelete(page).click();
    await expect(oneDialog(page)).toHaveAccessibleDescription(W.oneText);
    await oneDialog(page).getByRole('button', { name: W.cancel, exact: true }).click();
    await ensureList(page);
    await entry(page, W.deleteAll).click();
    await expect(allDialog(page)).toHaveAccessibleDescription(W.allText(4));
  });

  test('AC-21 The failure lines are alerts: the list that could not load, the chat that could not open, and the delete that did not go through', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.mode.list = 'failed';
    await onFullPage({ page, signIn, hr, chats: c });
    await ensureList(page);
    await expect(page.getByRole('alert').filter({ hasText: W.loadFailed })).toBeVisible();
    // A chat that cannot be opened: needs a list, so read it again first.
    c.mode.list = 'ok';
    await nav(page).getByRole('button', { name: W.retry, exact: true }).or(nav(page).getByRole('link', { name: W.retry, exact: true })).click();
    await expect(entry(page, T.docs)).toBeVisible();
    c.script('open', 'failed');
    await entry(page, T.docs).click();
    await expect(page.getByRole('alert').filter({ hasText: W.openFailed })).toBeVisible();
    // A delete that fails: Delete all my chats.
    await ensureList(page);
    c.mode['delete-all'] = 'failed';
    await entry(page, W.deleteAll).click();
    await confirmButton(allDialog(page), true).click();
    await expect(allDialog(page).getByRole('alert')).toHaveText(W.failed);
  });

  test('AC-21 "No chats found." is a polite status', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    await onFullPage({ page, signIn, hr, chats: chats! });
    await ensureList(page);
    await entry(page, W.search).click();
    await searchBox(page).fill('zzz');
    const status = nav(page).getByRole('status').filter({ hasText: W.noMatch });
    await expect(status).toBeVisible();
    expect(await status.evaluate((e) => e.closest('[role="alert"]') === null && e.getAttribute('aria-live') !== 'assertive')).toBe(true);
  });
});

// ================================================================ AC-22, AC-23, AC-24: private data

/** Person A's own chats, worded so that none of it can be mistaken for the new chat's greeting or suggestions. */
const A = { salary: 'Alpha Logistics salary query', leave: 'Alpha Logistics leave policy', hiring: 'Alpha Logistics hiring plan' };
const A_CHATS = (): StoredChat[] => [
  chat(61, A.salary, sast('2026-11-19', '15:40')),
  chat(62, A.leave, sast('2026-11-18', '15:40')),
  chat(63, A.hiring, sast('2026-11-14', '10:30')),
];

test.describe('Private data', () => {
  const HTML_TITLE = '<img src=x onerror=alert(1)>Kagiso';
  const HTML_TEXT = '<b>bold</b> and <script>window.__pwned = 1</script>';

  test('AC-22 A stored title and message with markup show as characters and create no element', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const alerts: string[] = [];
    page.on('dialog', async (d) => { alerts.push(d.message()); await d.dismiss(); });
    const stored = [chat(31, HTML_TITLE, sast('2026-11-19', '15:40'), [
      { role: 'person', text: 'What is in this chat?', at: sast('2026-11-19', '15:40') },
      { role: 'batsi', text: HTML_TEXT, at: sast('2026-11-19', '15:40') },
    ])];
    await onFullPage({ page, signIn, hr, chats: chats! }, stored);
    await ensureList(page);
    await expect(entry(page, HTML_TITLE), 'the title shows its characters').toBeVisible();
    await expect(nav(page).locator('img[src="x"]'), 'no element was made from the title').toHaveCount(0);
    await entry(page, HTML_TITLE).click();
    await expect(heading(page)).toHaveText(HTML_TITLE);
    await expect(heading(page).locator('img'), 'nor in the heading').toHaveCount(0);
    await expect(log(page)).toContainText('<b>bold</b>');
    await expect(log(page).locator('b'), 'no bold element in the conversation').toHaveCount(0);
    await expect(log(page).locator('script'), 'no script element').toHaveCount(0);
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__pwned), 'nothing ran').toBeUndefined();
    expect(alerts, 'no alert box').toEqual([]);
  });

  test('AC-22 After using the list, opening a chat and deleting one, local storage, session storage and IndexedDB hold no title, message text or chat id', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    const stored = [
      chat(41, 'Quarterly headcount review', sast('2026-11-19', '15:40'), [
        { role: 'person', text: 'Brenda Mokoena submitted her bank letter?', at: sast('2026-11-19', '15:40') },
        { role: 'batsi', text: 'Her bank letter matches the form.', at: sast('2026-11-19', '15:40') },
      ]),
      chat(42, 'Leave balances for December', sast('2026-11-18', '15:40')),
    ];
    await onFullPage({ page, signIn, hr, chats: c }, stored);
    await open(page, 'Quarterly headcount review');
    await expect(said(log(page), 'Her bank letter matches the form.')).toBeVisible();
    c.reply = () => 'Stored answer text about payroll.';
    await ask(page, 'Distinctive typed question about shifts');
    await expect(said(log(page), 'Stored answer text about payroll.')).toBeVisible();
    await open(page, 'Leave balances for December');
    await headerDelete(page).click();
    await confirmButton(oneDialog(page), false).click();
    await expect(oneDialog(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    const kept = await page.evaluate(async () => {
      const out: string[] = [];
      for (const s of [window.localStorage, window.sessionStorage]) for (let i = 0; i < s.length; i++) out.push(`${s.key(i)}=${s.getItem(s.key(i) ?? '')}`);
      const dbs = (await (indexedDB as any).databases?.()) ?? [];
      for (const info of dbs) {
        await new Promise<void>((done) => {
          const req = indexedDB.open(info.name!);
          req.onerror = () => done();
          req.onsuccess = () => {
            const db = req.result;
            const names = Array.from(db.objectStoreNames);
            if (!names.length) { db.close(); return done(); }
            const tx = db.transaction(names, 'readonly');
            let left = names.length;
            for (const n of names) {
              const all = tx.objectStore(n).getAll();
              all.onsuccess = () => { out.push(`${info.name}/${n}=${JSON.stringify(all.result)}`); if (--left === 0) { db.close(); done(); } };
              all.onerror = () => { if (--left === 0) { db.close(); done(); } };
            }
          };
        });
      }
      return out.join('\n');
    });
    const markers = ['Quarterly headcount review', 'Leave balances', 'Brenda Mokoena', 'bank letter matches', 'Stored answer text', 'Distinctive typed question', chatId(41), chatId(42), 'headcount', '01NEW'];
    for (const m of markers) expect(kept, `the browser keeps no "${m}"`).not.toContain(m);
  });

  test('AC-23 Person A (company A) opens an old chat and signs out; person B (company B) signs in on the same browser: none of A’s titles or messages show at any moment, the panel is empty and every chats call carries B’s token', async ({ page, signIn, hr, chats, cognito }) => {
    noBackendOnly();
    const c = chats!;
    const B = { email: 'kgosi.dlamini@zulu-foods.co.za', givenName: 'Kgosi', familyName: 'Dlamini', groups: ['hr_staff'] };
    cognito!.addAccount(B);
    const bLogin: Login = { email: B.email, password: hr.password, givenName: B.givenName } as Login;
    c.seed(B.email, [chat(51, 'Zulu Foods payroll run', sast('2026-11-19', '14:00'))]);
    await onFullPage({ page, signIn, hr, chats: c }, A_CHATS());
    await open(page, A.salary);
    await expect(said(log(page), `Answer to: ${A.salary}`)).toBeVisible();
    const A_WORDS = [A.salary, A.leave, A.hiring, `Answer to: ${A.salary}`];
    const hits = await watchFor(page, A_WORDS);
    expect(await hits(), 'sanity: the watcher sees A’s words while A is signed in').not.toEqual([]);
    const seenBefore = c.calls.length;
    c.hold('list', B.email);
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(signIn.email).toBeVisible();
    await page.evaluate(() => (window as any).__acceptanceHits.clear());
    await signIn.signInAs(bLogin);
    await expect(page).toHaveURL(/\/hr$/);
    // The panel first: it is empty.
    await askButton(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(said(panel(page).getByRole('log'), `Answer to: ${A.salary}`), 'the panel holds nothing of A’s').toHaveCount(0);
    await panel(page).getByRole('button', { name: 'Open as a full page', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${FULL_PAGE}$`));
    await expect.poll(() => c.of('list').filter((x) => x.email === B.email.toLowerCase()).length, { message: 'B’s list read is on its way (and held)' }).toBeGreaterThan(0);
    await ensureList(page);
    expect(await screenText(page), 'while B’s list is held, nothing of A’s is on the screen').not.toMatch(new RegExp(A_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')));
    await expect(heading(page)).toHaveText(W.newChat);
    c.release('list', B.email);
    await expect(entry(page, 'Zulu Foods payroll run'), 'B’s own chat shows').toBeVisible();
    for (const t of [A.salary, A.leave, A.hiring]) await expect(entry(page, t)).toHaveCount(0);
    expect(await hits(), 'at no moment did any of A’s words show').toEqual([]);
    const after = c.calls.slice(seenBefore).filter((x) => x.route !== 'pending');
    expect(after.length).toBeGreaterThan(0);
    expect(after.map((x) => x.email), 'every chats call after sign-out carries B’s token').toEqual(after.map(() => B.email.toLowerCase()));
    expect(c.stored(hr.email), 'A’s chats are untouched').toHaveLength(3);
  });

  for (const late of ['answer', 'failure'] as const) test(`AC-23 A list ${late} for A that arrives after B has signed in is dropped`, async ({ page, signIn, hr, chats, cognito }) => {
    noBackendOnly();
    const c = chats!;
    const B = { email: 'kgosi.dlamini@zulu-foods.co.za', givenName: 'Kgosi', familyName: 'Dlamini', groups: ['hr_staff'] };
    cognito!.addAccount(B);
    const bLogin: Login = { email: B.email, password: hr.password, givenName: B.givenName } as Login;
    c.seed(B.email, [chat(51, 'Zulu Foods payroll run', sast('2026-11-19', '14:00'))]);
    c.seed(hr.email, A_CHATS());
    await clockAt({ page, chats: c });
    await signedIn({ page, signIn, hr });
    // A's page is still waiting for the list when A leaves.
    c.hold('list', hr.email);
    await page.getByRole('button', { name: /^Ask Batsi/ }).click();
    await panel(page).getByRole('button', { name: 'Open as a full page', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${FULL_PAGE}$`));
    await expect.poll(() => c.of('list').filter((x) => x.email === hr.email.toLowerCase()).length).toBe(1);
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await signIn.signInAs(bLogin);
    await expect(page).toHaveURL(/\/hr$/);
    await askButton(page).click();
    await panel(page).getByRole('button', { name: 'Open as a full page', exact: true }).click();
    await ensureList(page);
    await expect(entry(page, 'Zulu Foods payroll run')).toBeVisible();
    const hits = await watchFor(page, [A.salary, A.leave, A.hiring]);
    if (late === 'failure') c.script('list', 'failed');
    c.release('list', hr.email);
    await page.waitForTimeout(600);
    for (const t of [A.salary, A.leave, A.hiring]) await expect(entry(page, t), 'A’s late answer is not shown').toHaveCount(0);
    await expect(entry(page, 'Zulu Foods payroll run')).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: W.loadFailed }), 'A’s late failure is not shown to B').toHaveCount(0);
    expect(await hits(), 'not for a moment').toEqual([]);
  });

  const bPerson = { email: 'kgosi.dlamini@zulu-foods.co.za', givenName: 'Kgosi', familyName: 'Dlamini', groups: ['hr_staff'] };

  test('AC-23 B’s first question after A signs out carries no chat id (A had an old chat open)', async ({ page, signIn, hr, chats, cognito }) => {
    noBackendOnly();
    const c = chats!;
    cognito!.addAccount(bPerson);
    const bLogin: Login = { email: bPerson.email, password: hr.password, givenName: bPerson.givenName } as Login;
    c.seed(bPerson.email, [chat(51, 'Zulu Foods payroll run', sast('2026-11-19', '14:00'))]);
    c.reply = () => 'An answer for B.';
    await onFullPage({ page, signIn, hr, chats: c }, A_CHATS());
    await open(page, A.salary);
    await ask(page, 'A asks in the old chat');
    await expect.poll(() => c.asks().filter((x) => x.email === hr.email.toLowerCase()).length).toBe(1);
    expect(c.asks()[0]!.body.chatId, 'sanity: A’s question carried the old chat’s id').toBe(c.asks()[0]!.chatId);
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await signIn.signInAs(bLogin);
    await expect(page).toHaveURL(/\/hr$/);
    await askButton(page).click();
    await panel(page).getByRole('button', { name: 'Open as a full page', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${FULL_PAGE}$`));
    await ask(page, 'Hello from B');
    await expect(said(log(page), 'An answer for B.')).toBeVisible();
    const mine = c.asks().filter((x) => x.email === bPerson.email.toLowerCase());
    expect(mine, 'B asked once').toHaveLength(1);
    expect(Object.keys(mine[0]!.body ?? {}), 'B’s first question has no chatId at all').not.toContain('chatId');
  });

  test('AC-23 A’s question answered after A has signed out and B has signed in is never on B’s screen, and B’s chat is still New chat', async ({ page, signIn, hr, chats, cognito }) => {
    noBackendOnly();
    const c = chats!;
    cognito!.addAccount(bPerson);
    const bLogin: Login = { email: bPerson.email, password: hr.password, givenName: bPerson.givenName } as Login;
    c.seed(bPerson.email, [chat(51, 'Zulu Foods payroll run', sast('2026-11-19', '14:00'))]);
    c.reply = () => 'ALPHA SECRET ANSWER for A only.';
    await onFullPage({ page, signIn, hr, chats: c }, A_CHATS());
    c.hold('ask');
    await ask(page, 'A slow question about salaries');
    await expect.poll(() => c.asks().length, { message: 'A’s question is on its way and held' }).toBe(1);
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await signIn.signInAs(bLogin);
    await expect(page).toHaveURL(/\/hr$/);
    await askButton(page).click();
    await panel(page).getByRole('button', { name: 'Open as a full page', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${FULL_PAGE}$`));
    const hits = await watchFor(page, ['ALPHA SECRET ANSWER', 'A slow question about salaries']);
    c.release('ask');
    await page.waitForTimeout(700);
    expect(await screenText(page), 'A’s answer is not on B’s screen').not.toContain('ALPHA SECRET ANSWER');
    expect(await hits(), 'not for a moment').toEqual([]);
    await expect(heading(page), 'B’s chat is still New chat').toHaveText(W.newChat);
    await expect(said(log(page), W.hello.replace('Jane', bPerson.givenName)), 'the greeting is B’s').toBeVisible();
  });

  test('AC-24 A late answer stays in its own chat: with an answer held back, opening another old chat does not show it there; it is in the first chat when opened again', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.reply = () => 'The held answer.';
    await onFullPage({ page, signIn, hr, chats: c });
    await open(page, T.docs);
    c.hold('ask');
    await ask(page, 'A slow question');
    await expect.poll(() => c.asks().length).toBe(1);
    await open(page, T.week);
    await expect(said(log(page), `Answer to: ${T.week}`)).toBeVisible();
    c.release('ask');
    await page.waitForTimeout(600);
    await expect(said(log(page), 'The held answer.'), 'not shown in the chat that is open now').toHaveCount(0);
    await expect(said(log(page), 'A slow question'), 'nor the question').toHaveCount(0);
    await expect(heading(page)).toHaveText(T.week);
    await open(page, T.docs);
    await expect(said(log(page), 'The held answer.'), 'it is there when the first chat is opened again').toBeVisible();
  });

  test('AC-24 The same when the person presses New chat: the held answer is not shown in the new chat, and is in the old chat when it is opened again', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.reply = () => 'The held answer.';
    await onFullPage({ page, signIn, hr, chats: c });
    await open(page, T.docs);
    c.hold('ask');
    await ask(page, 'A slow question');
    await expect.poll(() => c.asks().length).toBe(1);
    await ensureList(page);
    await entry(page, W.newChat).click();
    await expect(heading(page)).toHaveText(W.newChat);
    c.release('ask');
    await page.waitForTimeout(600);
    await expect(said(log(page), 'The held answer.')).toHaveCount(0);
    await expect(said(log(page), 'A slow question')).toHaveCount(0);
    await expect(said(log(page), W.hello), 'the new chat is still a new chat').toBeVisible();
    await expect(heading(page)).toHaveText(W.newChat);
    await open(page, T.docs);
    await expect(said(log(page), 'The held answer.')).toBeVisible();
  });
});

// ================================================================ AC-25, AC-26: older cards, no AI

test.describe('Older cards and no AI', () => {
  test('AC-25 Where /v1/chats is not answered (CHAT-01’s fake only answers the question route) the page stays usable: one Back to Today, asking works, and no chat id is sent when the answer gave none', async ({ page, signIn, hr, context, baseURL }) => {
    noBackendOnly();
    const old = new ChatFake(new URL(baseURL!).origin);
    old.reply = () => ({ message: 'Answered by the old fake.' });
    await old.install(context);
    await signedIn({ page, signIn, hr });
    await page.goto(FULL_PAGE);
    await expect(composer(page)).toBeVisible();
    await expect(backLink(page), 'exactly one link named Back to Today in the accessibility tree').toHaveCount(1);
    await expectClearOfTopBar(page, backLink(page), 'Back to Today');
    await ask(page, 'First question');
    await expect(said(log(page), 'Answered by the old fake.')).toBeVisible();
    await ask(page, 'Second question');
    await expect(said(log(page), 'Answered by the old fake.')).toHaveCount(2);
    expect(old.chats().map((x) => 'chatId' in x.body), 'the answers carried no chat id, so none is sent').toEqual([false, false]);
    expect(old.chats()).toHaveLength(2);
    await expect(backLink(page), 'still one').toHaveCount(1);
  });

  test('AC-14 The list read has no answer at all (no fake for /v1/chats): the line and Try again show, and the page stays usable', async ({ page, signIn, hr, context, baseURL }) => {
    noBackendOnly();
    const old = new ChatFake(new URL(baseURL!).origin);
    old.reply = () => ({ message: 'Answered by the old fake.' });
    await old.install(context);
    await signedIn({ page, signIn, hr });
    await page.goto(FULL_PAGE);
    await expect(composer(page)).toBeVisible();
    await ensureList(page);
    await expect(nav(page).getByRole('alert')).toHaveText(W.loadFailed);
    await expect(nav(page).getByRole('button', { name: W.retry, exact: true }).or(nav(page).getByRole('link', { name: W.retry, exact: true }))).toBeVisible();
    await expect(entry(page, W.deleteAll)).toBeVisible();
    if (isPhone(page)) await menuButton(page).click();
    await ask(page, 'First question');
    await expect(said(log(page), 'Answered by the old fake.')).toBeVisible();
  });

  test('AC-26 A question reaches no AI host: the fake answers it and nothing else is called', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    const seen: string[] = [];
    page.on('request', (r) => seen.push(r.url()));
    c.reply = () => 'Fake answer.';
    await signedIn({ page, signIn, hr });
    await page.goto(FULL_PAGE);
    await ask(page, 'A question');
    await expect(said(log(page), 'Fake answer.')).toBeVisible();
    const ai = seen.filter((u) => /bedrock|textract|anthropic\.com|openai\.com|generativelanguage|api\.cohere|mistral\.ai/i.test(u));
    expect(ai, 'no request to an AI host').toEqual([]);
    expect(c.asks(), 'the question was the fake’s').toHaveLength(1);
  });

  test('AC-26 A whole visit (list, open, ask, search, delete one, delete all) reaches no AI host: every call is the fake’s', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    const seen: string[] = [];
    page.on('request', (r) => seen.push(r.url()));
    c.reply = () => 'Fake answer.';
    await onFullPage({ page, signIn, hr, chats: c });
    await open(page, T.docs);
    await ask(page, 'A question');
    await expect(said(log(page), 'Fake answer.')).toBeVisible();
    await ensureList(page);
    await entry(page, W.search).click();
    await searchBox(page).fill('risk');
    await page.keyboard.press('Escape');
    await open(page, T.risk);
    await headerDelete(page).click();
    await confirmButton(oneDialog(page), false).click();
    await expect(oneDialog(page)).toHaveCount(0);
    await ensureList(page);
    await entry(page, W.deleteAll).click();
    await confirmButton(allDialog(page), true).click();
    await expect(allDialog(page)).toHaveCount(0);
    const ai = seen.filter((u) => /bedrock|textract|anthropic\.com|openai\.com|generativelanguage|api\.cohere|mistral\.ai/i.test(u));
    expect(ai, 'no request to an AI host').toEqual([]);
    expect(c.calls.length, 'the fake answered every chat call').toBeGreaterThan(5);
    const chatCalls = seen.filter((u) => /\/v1\/chats|\/agent\/v1\//.test(u));
    expect(chatCalls.length).toBeGreaterThanOrEqual(c.calls.length);
  });
});
