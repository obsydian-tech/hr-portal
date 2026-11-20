import type { Locator, Page } from '@playwright/test';
import { DocumentsFake } from './support/documents-fake';
import { EmployeesFake } from './support/employees-fake';
import { ChatFake } from './support/chat-01/chat-fake';
import { ChatsFake, chat, chatId, type StoredChat } from './support/chat-14/chats-fake';
import { ON_DEV, avatarButton, expect, test as base, type Login, type SignInPage } from './support/fixtures';

/**
 * CHAT-17 · Ask Batsi chat list: a clean list, "No chats yet.", and the last chat on arrival.
 * Spec: /mnt/project-files/ask-batsi-chat/CHAT-17-chat-list-look-and-reload.md (AC-1 to AC-22). Notes: cards/chat-17.md.
 *
 * Fake answers only: the chat routes and the question route are answered in the browser by CHAT-14's fake
 * (support/chat-14/chats-fake.ts, used as it is). No test calls Bedrock or any paid AI. The words are the approved ones
 * (words.json, CHAT-14's W14-1 to W14-5) and the one new sentence "No chats yet." (W16-1, logged 20 Nov 2026).
 * Each test runs at 1280 and 390 wide unless it says one width.
 */

type Fixtures = { chats: ChatsFake | null; docs: DocumentsFake | null; list: EmployeesFake | null };

const test = base.extend<Fixtures>({
  // Not automatic: AC-21 runs the page with CHAT-01's fake, which does not answer /v1/chats.
  chats: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new ChatsFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
    expect(fake.violations, 'every chats call carries the ID token and nothing else that names a person or a company').toEqual([]);
  },
  docs: [async ({ context, baseURL }, use) => { if (ON_DEV) return use(null); const f = new DocumentsFake(new URL(baseURL!).origin); await f.install(context); await use(f); }, { auto: true }],
  list: [async ({ context, baseURL }, use) => { if (ON_DEV) return use(null); const f = new EmployeesFake(new URL(baseURL!).origin); await f.install(context); await use(f); }, { auto: true }],
});

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake Agent API.');
const phoneOnly = (name: string) => test.skip(name !== 'phone-390', 'Runs at 390 wide only.');

const FULL_PAGE = '/hr/ask-batsi';

/** The words: approved (words.json), CHAT-14's logged ones, and W16-1. Nothing else is new. */
const W = {
  back: 'Back to Today',
  newChat: 'New chat',
  search: 'Search chats',
  deleteChat: 'Delete chat',
  deleteAll: 'Delete all my chats',
  chats: 'Chats',
  today: 'Today',
  yesterday: 'Yesterday',
  previous: 'Previous 7 days',
  looking: 'Looking at Today',
  hello: 'Hi Jane. Pick a question or ask me.',
  notOn: 'Ask Batsi is not switched on for your company.',
  notOnNext: 'Ask your administrator to switch it on.',
  retry: 'Try again',
  noMatch: 'No chats found.',
  loadFailed: 'We could not load your chats.',
  openFailed: 'We could not open this chat.',
  empty: 'No chats yet.',
  suggestDocs: 'Who hasn’t sent their documents?',
  suggestRisk: 'Which candidates are at risk?',
};

// ---------------------------------------------------------------- the chats and the clock

/** 19 Nov 2026, 18:00 in South Africa. */
const NOW = new Date('2026-11-19T16:00:00Z');
const sast = (day: string, time: string): string => new Date(`${day}T${time}:00+02:00`).toISOString();

const T = {
  last: 'Leave balances for the finance team',
  payroll: 'Payroll cut-off for December',
  banks: 'Bank letters still outstanding',
  starters: 'Starters for next week',
};
const LAST_SAID = 'Thandi and Sipho have leave left.';
/** The most recently updated chat is not the first one written down, and its number is not the lowest. */
const FOUR = (): StoredChat[] => [
  chat(2, T.payroll, sast('2026-11-19', '09:05')),
  chat(3, T.banks, sast('2026-11-18', '15:12')),
  chat(7, T.last, sast('2026-11-19', '15:40'), [
    { role: 'person', text: 'Who in finance has leave left?', at: sast('2026-11-19', '15:40') },
    { role: 'batsi', text: LAST_SAID, at: sast('2026-11-19', '15:40') },
  ]),
  chat(4, T.starters, sast('2026-11-14', '10:30')),
];
const LONG = 'Which new starters in the Johannesburg and Cape Town offices still have outstanding bank letters and tax forms?';
const WITH_LONG = (): StoredChat[] => [...FOUR(), chat(8, LONG, sast('2026-11-16', '11:00'))];
const MANY = (count: number): StoredChat[] =>
  Array.from({ length: count }, (_, i) => chat(100 + i, `Chat number ${String(i + 1).padStart(3, '0')}`, new Date(NOW.getTime() - 5 * 60_000 - i * 1000)));

type Who = { page: Page; signIn: SignInPage; hr: Login };
type Setup = Who & { chats: ChatsFake };

async function clockAt(s: { page: Page; chats: ChatsFake }): Promise<void> {
  await s.page.clock.setFixedTime(NOW);
  s.chats.now = () => NOW;
}

async function signedIn(s: Who): Promise<void> {
  await s.signIn.open();
  await s.signIn.signInAs(s.hr);
  await expect(s.page).toHaveURL(/\/hr$/);
  await expect(s.page.locator('main h1').first()).toBeVisible();
}

/** Seeds the person's chats, sets the clock, signs in, and loads the full page in the browser (as a reload or a typed address does). */
async function arrive(s: Setup, stored: StoredChat[] = FOUR()): Promise<void> {
  s.chats.seed(s.hr.email, stored);
  await clockAt(s);
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
/** The side panel's New chat button (CHAT-17, Iggie 20 Nov: the panel matches the full page). */
const panelNewChat = (page: Page): Locator => panel(page).getByRole('button', { name: W.newChat, exact: true });
const panelLog = (page: Page): Locator => panel(page).getByRole('log');
const heading = (page: Page): Locator => page.getByRole('heading', { level: 1 });
const nav = (page: Page): Locator => page.getByRole('navigation', { name: W.chats, exact: true });
const menuButton = (page: Page): Locator => page.getByRole('button', { name: 'Open menu', exact: true });
const topBar = (page: Page): Locator => page.locator('.pp-top-navigation');
const backLink = (page: Page): Locator => page.getByRole('link', { name: W.back, exact: true });
const pick = (scope: Locator, name: string): Locator => scope.getByRole('link', { name, exact: true }).or(scope.getByRole('button', { name, exact: true }));
const entry = (page: Page, name: string): Locator => pick(nav(page), name);
const group = (page: Page, name: string): Locator => nav(page).getByRole('list', { name, exact: true });
const headerDelete = (page: Page): Locator => page.getByRole('button', { name: W.deleteChat, exact: true }).first();
const said = (scope: Locator, text: string): Locator => scope.getByText(text, { exact: true });
const empty = (scope: Locator): Locator => scope.getByText(W.empty, { exact: true });
const searchBox = (page: Page): Locator => page.getByRole('searchbox', { name: W.search, exact: true }).or(page.getByRole('textbox', { name: W.search, exact: true }));
const allDialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Delete all your chats?', exact: true }).or(page.getByRole('alertdialog', { name: 'Delete all your chats?', exact: true }));
const screenText = (page: Page): Promise<string> => page.locator('body').innerText();

async function listShown(page: Page): Promise<boolean> {
  if (!(await nav(page).count())) return false;
  return nav(page).first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    const style = getComputedStyle(e);
    return style.visibility !== 'hidden' && style.display !== 'none' && r.width > 0 && r.left >= -2 && r.right > 40 && r.left < window.innerWidth - 40;
  });
}
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
  await settled(page);
}
async function closeList(page: Page): Promise<void> {
  if (!isPhone(page)) return;
  await settled(page);
  if (!(await listShown(page))) return;
  await menuButton(page).click();
  await expect.poll(() => listShown(page), { message: 'the list closed' }).toBe(false);
}

async function ask(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await sendButton(page).click();
}

type Rect = { top: number; bottom: number; left: number; right: number; width: number; height: number };
const rect = async (l: Locator): Promise<Rect> => l.evaluate((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; });

async function expectOnScreen(page: Page, l: Locator, what: string): Promise<void> {
  const r = await rect(l);
  const { h, w } = await page.evaluate(() => ({ h: window.innerHeight, w: window.innerWidth }));
  expect(r.width, `${what} has a size`).toBeGreaterThan(0);
  expect(r.top, `${what} starts on screen`).toBeGreaterThanOrEqual(0);
  expect(r.bottom, `${what} ends on screen`).toBeLessThanOrEqual(h + 0.5);
  expect(r.left, `${what} is inside the width`).toBeGreaterThanOrEqual(0);
  expect(r.right, `${what} is inside the width`).toBeLessThanOrEqual(w + 0.5);
}
async function expectClearOfTopBar(page: Page, l: Locator, what: string): Promise<void> {
  await expectOnScreen(page, l, what);
  const bar = await rect(topBar(page));
  const r = await rect(l);
  if (r.right <= bar.left + 1 || r.left >= bar.right - 1) return;
  expect(r.top, `${what} is not under the top bar`).toBeGreaterThanOrEqual(bar.bottom - 1.5);
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

/** What the browser keeps: local storage, session storage and every IndexedDB store, as one text. */
const kept = (page: Page): Promise<string> => page.evaluate(async () => {
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

// ---------------------------------------------------------------- how a thing looks, read from the browser

type Look = {
  /** A border that shows: some side has width, a style and a colour that is not fully see-through. */
  border: string | null;
  /** The fill, when it is not fully see-through. */
  fill: string | null;
  shadow: string | null;
  /** A ::before or ::after that draws a box (a bar, a mark). */
  mark: string | null;
  icons: number;
  /** Text colour against the first fill behind it: the contrast ratio. */
  contrast: number;
};

const look = (l: Locator): Promise<Look> => l.evaluate((e) => {
  const rgba = (c: string): [number, number, number, number] => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return c === 'transparent' ? [0, 0, 0, 0] : [0, 0, 0, 1];
    const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0]!, p[1]!, p[2]!, p.length > 3 ? p[3]! : 1];
  };
  const seen = (c: string) => rgba(c)[3] > 0.02;
  const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
  const borderOf = (s: CSSStyleDeclaration): string | null => {
    for (const side of sides) {
      const w = parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`));
      const st = s.getPropertyValue(`border-${side.toLowerCase()}-style`);
      const c = s.getPropertyValue(`border-${side.toLowerCase()}-color`);
      if (w > 0 && st !== 'none' && st !== 'hidden' && seen(c)) return `${side.toLowerCase()} ${w}px ${st} ${c}`;
    }
    return null;
  };
  const s = getComputedStyle(e);
  const markOf = (which: '::before' | '::after'): string | null => {
    const p = getComputedStyle(e, which);
    if (p.content === 'none' || p.content === 'normal' || p.display === 'none' || p.visibility === 'hidden') return null;
    const w = parseFloat(p.width) || 0;
    const h = parseFloat(p.height) || 0;
    const paints = seen(p.backgroundColor) || p.backgroundImage !== 'none' || !!borderOf(p) || (p.boxShadow && p.boxShadow !== 'none');
    return paints && (w > 0 || h > 0 || p.position === 'absolute') ? `${which} ${p.width}x${p.height} ${p.backgroundColor}` : null;
  };
  // The fill behind the text: the element's own, else the first one up the tree.
  let bg: [number, number, number, number] = [255, 255, 255, 1];
  for (let n: Element | null = e; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0.5) { bg = c; break; } }
  const fg = rgba(s.color);
  const lum = ([r, g, b]: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!); };
  const a = lum(fg), b = lum(bg);
  return {
    border: borderOf(s),
    fill: seen(s.backgroundColor) ? s.backgroundColor : null,
    shadow: s.boxShadow && s.boxShadow !== 'none' ? s.boxShadow : null,
    mark: markOf('::before') ?? markOf('::after'),
    icons: e.querySelectorAll('svg, img, [class*="icon" i]:not(svg *)').length,
    contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
  };
});

/** The fill of the column itself (the first fill up from it). */
const columnFill = (page: Page): Promise<string> => nav(page).evaluate((e) => {
  for (let n: Element | null = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c)) return c; }
  return 'rgb(255, 255, 255)';
});

/** Let any hover or press colour settle: the pointer goes to a corner far from the list. */
async function restPointer(page: Page): Promise<void> {
  const vp = page.viewportSize()!;
  if (!isPhone(page)) await page.mouse.move(vp.width - 5, vp.height - 5);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.waitForTimeout(250);
}

/** The element that holds a title's words (the item itself, or the deepest element inside it with exactly those words). */
async function textOf(row: Locator, title: string): Promise<Locator> {
  await row.evaluate((e, t) => {
    let best: Element = e;
    for (const n of Array.from(e.querySelectorAll('*'))) if ((n.textContent ?? '').trim() === t) best = n;
    best.setAttribute('data-acceptance-title', 'yes');
  }, title);
  return row.locator('[data-acceptance-title="yes"]').or(row.and(row.page().locator('[data-acceptance-title="yes"]'))).first();
}

// ================================================================ AC-1 to AC-5: the look

test.describe('A clean list', () => {
  test('AC-1 The list is words only: chat rows have no border, no fill, no shadow and no icon; the open chat has a soft fill and no accent bar; New chat, Search chats and Delete all my chats keep one icon each; every row is the column’s full width', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    await arrive({ page, signIn, hr, chats: chats! });
    await expect(heading(page)).toHaveText(T.last);
    await ensureList(page);
    await expect(entry(page, T.last)).toHaveAttribute('aria-current', 'page');
    await restPointer(page);
    for (const t of [T.payroll, T.banks, T.starters]) {
      const l = await look(entry(page, t));
      expect.soft(l.border, `"${t}": no border`).toBeNull();
      expect.soft(l.fill, `"${t}": no fill (it is not a box)`).toBeNull();
      expect.soft(l.shadow, `"${t}": no shadow`).toBeNull();
      expect.soft(l.mark, `"${t}": no bar or mark drawn beside it`).toBeNull();
      expect.soft(l.icons, `"${t}": no icon`).toBe(0);
    }
    const open = await look(entry(page, T.last));
    expect.soft(open.fill, 'the open chat has a fill').not.toBeNull();
    expect.soft(open.fill, 'a fill of its own, not the column’s').not.toBe(await columnFill(page));
    expect.soft(open.border, 'the open chat: no border').toBeNull();
    expect.soft(open.shadow, 'the open chat: no shadow').toBeNull();
    expect.soft(open.mark, 'the open chat: no accent bar').toBeNull();
    expect.soft(open.icons, 'the open chat: no icon').toBe(0);
    for (const n of [W.newChat, W.search, W.deleteAll]) {
      const l = await look(entry(page, n));
      expect.soft(l.icons, `"${n}" keeps its icon (one)`).toBe(1);
    }
    // Plain full-width lines: every entry and every chat starts at the same left edge and has the same width.
    const rows = [W.newChat, W.search, T.last, T.payroll, T.banks, T.starters, W.deleteAll];
    const boxes: Rect[] = [];
    for (const n of rows) boxes.push(await rect(entry(page, n)));
    const column = await rect(nav(page));
    for (const [i, b] of boxes.entries()) {
      expect.soft(Math.abs(b.left - boxes[0]!.left), `"${rows[i]}" starts where the others start`).toBeLessThanOrEqual(1);
      expect.soft(Math.abs(b.width - boxes[0]!.width), `"${rows[i]}" is as wide as the others (a full-width line, not a box around its words)`).toBeLessThanOrEqual(1);
    }
    expect.soft(boxes[0]!.width, 'the lines fill the column (bar its side padding)').toBeGreaterThanOrEqual(column.width - 48);
  });

  test('AC-2 A long title ends with "…" inside the column; a short one is whole; nothing runs past the column’s edge and the column does not scroll sideways', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    await arrive({ page, signIn, hr, chats: chats! }, WITH_LONG());
    await expect(heading(page)).toHaveText(T.last);
    await ensureList(page);
    const column = await rect(nav(page));
    const row = entry(page, LONG);
    await expect(row, 'the full title stays the item’s name').toBeVisible();
    const words = await textOf(row, LONG);
    const cut = await words.evaluate((e) => {
      const s = getComputedStyle(e);
      return { overflow: s.overflowX, ellipsis: s.textOverflow, wrap: s.whiteSpace, scroll: e.scrollWidth, client: e.clientWidth };
    });
    expect.soft(cut.ellipsis, 'a long title is cut with an ellipsis').toBe('ellipsis');
    expect.soft(['hidden', 'clip']).toContain(cut.overflow);
    expect.soft(['nowrap', 'pre']).toContain(cut.wrap);
    expect.soft(cut.scroll, 'the title is longer than the line, so the line shows “…”').toBeGreaterThan(cut.client);
    const r = await rect(row);
    const w = await rect(words);
    expect.soft(r.right, 'the row ends inside the column').toBeLessThanOrEqual(column.right + 0.5);
    expect.soft(w.right, 'the title’s words end inside the row').toBeLessThanOrEqual(r.right + 0.5);
    expect.soft((await rect(row)).height, 'one line, the same height as a short title').toBeLessThanOrEqual((await rect(entry(page, T.payroll))).height + 1);
    // A short title is whole: no ellipsis drawn.
    const short = await textOf(entry(page, T.payroll), T.payroll);
    expect.soft(await short.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), 'a short title is not cut').toBe(true);
    // Nothing in the column runs past its right edge, and nothing in it scrolls sideways.
    const over = await nav(page).evaluate((root) => {
      const edge = root.getBoundingClientRect().right + 0.5;
      const out: string[] = [];
      for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > edge) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}" ends at ${Math.round(r.right)} past ${Math.round(edge)}`);
        if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()} scrolls sideways`);
      }
      return out;
    });
    expect(over, 'nothing runs under the column edge').toEqual([]);
  });

  test('AC-3 New chat, Search chats, Delete all my chats and Delete chat are plain text: no border, no fill, no shadow while at rest', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    await arrive({ page, signIn, hr, chats: chats! });
    await expect(heading(page)).toHaveText(T.last);
    await ensureList(page);
    await restPointer(page);
    for (const n of [W.newChat, W.search, W.deleteAll]) {
      const l = await look(entry(page, n));
      expect.soft(l.border, `"${n}": no border`).toBeNull();
      expect.soft(l.fill, `"${n}": no fill`).toBeNull();
      expect.soft(l.shadow, `"${n}": no shadow`).toBeNull();
      expect.soft(l.mark, `"${n}": nothing drawn beside it`).toBeNull();
    }
    await closeList(page);
    await restPointer(page);
    await expect(headerDelete(page)).toBeVisible();
    const d = await look(headerDelete(page));
    expect.soft(d.border, 'Delete chat: no border').toBeNull();
    expect.soft(d.fill, 'Delete chat: no fill').toBeNull();
    expect.soft(d.shadow, 'Delete chat: no shadow').toBeNull();
  });

  test('AC-4 Still easy to read and to use by keyboard: the words of every row, the open chat and the entries have a contrast of 4.5 to 1 or more, and a row reached with Tab shows a focus ring', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    await arrive({ page, signIn, hr, chats: chats! });
    await expect(heading(page)).toHaveText(T.last);
    await ensureList(page);
    await restPointer(page);
    for (const n of [W.newChat, W.search, T.last, T.payroll, T.banks, T.starters, W.deleteAll]) {
      const words = await textOf(entry(page, n), n);
      const l = await look(words);
      expect.soft(l.contrast, `"${n}": contrast`).toBeGreaterThanOrEqual(4.5);
    }
    // Keyboard: Tab onto New chat, then onto a chat row. Each shows a ring (an outline or a ring shadow).
    await entry(page, W.search).focus();
    await page.keyboard.press('Shift+Tab');
    await expect(entry(page, W.newChat)).toBeFocused();
    const ringOf = (l: Locator) => l.evaluate((e) => { const s = getComputedStyle(e); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow !== 'none' && s.boxShadow !== ''); });
    expect.soft(await ringOf(entry(page, W.newChat)), 'New chat shows a focus ring').toBe(true);
    await entry(page, T.banks).focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(entry(page, T.banks)).toBeFocused();
    expect.soft(await ringOf(entry(page, T.banks)), 'a chat row shows a focus ring').toBe(true);
  });

  test('AC-5 Every word stays as approved: the column holds only the entries, the group headings and the titles; the chat header only the title, the context line and Delete chat', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    await arrive({ page, signIn, hr, chats: chats! });
    await expect(heading(page)).toHaveText(T.last);
    await ensureList(page);
    const lines = (await nav(page).innerText()).split('\n').map((s) => s.trim()).filter(Boolean);
    const allowed = [W.back, W.chats, W.newChat, W.search, W.today, W.yesterday, W.previous, T.last, T.payroll, T.banks, T.starters, W.deleteAll];
    expect(lines.filter((x) => !allowed.includes(x)), 'no words in the column other than the approved ones and the titles').toEqual([]);
    for (const n of [W.newChat, W.search, W.deleteAll]) await expect(entry(page, n)).toBeVisible();
    await closeList(page);
    await expect(headerDelete(page)).toHaveText(W.deleteChat);
    await expect(page.getByText(W.looking, { exact: true })).toBeVisible();
  });
});

// ================================================================ AC-6 to AC-9: "No chats yet."

test.describe('No chats yet.', () => {
  test('AC-6 An empty list says “No chats yet.” once, in the column below Search chats, as plain text (a polite status, not a link, button or alert), on screen and clear of the top bar; the chat is a new one', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await arrive({ page, signIn, hr, chats: c }, []);
    await expect.poll(() => c.listReads().length).toBeGreaterThan(0);
    await ensureList(page);
    await expect(empty(nav(page))).toBeVisible();
    await expect(empty(page.locator('body')), 'once on the page').toHaveCount(1);
    await expect(nav(page).getByRole('status').filter({ hasText: W.empty }), 'a polite status').toHaveCount(1);
    await expect(page.getByRole('alert'), 'not an alert, and no error').toHaveCount(0);
    expect(await nav(page).locator('a, button').evaluateAll((els) => els.filter((e) => e.textContent?.includes('No chats yet')).length), 'not a link or a button').toBe(0);
    await expect(entry(page, W.newChat)).toBeVisible();
    await expect(entry(page, W.search)).toBeVisible();
    await expect(entry(page, W.deleteAll), 'no Delete all my chats').toHaveCount(0);
    await expect(nav(page).getByRole('list', { name: /.+/ }), 'no group heading').toHaveCount(0);
    await expect(page.getByText(W.noMatch), '“No chats found.” is only for a search').toHaveCount(0);
    const words = await rect(empty(nav(page)));
    const search = await rect(entry(page, W.search));
    const column = await rect(nav(page));
    expect(words.top, 'below Search chats').toBeGreaterThan(search.top);
    expect(words.left, 'inside the column').toBeGreaterThanOrEqual(column.left - 0.5);
    expect(words.right, 'inside the column').toBeLessThanOrEqual(column.right + 0.5);
    await expectClearOfTopBar(page, empty(nav(page)), '“No chats yet.”');
    await closeList(page);
    await expect(heading(page), 'nothing to open: a new chat').toHaveText(W.newChat);
    await expect(said(log(page), W.hello)).toBeVisible();
    await expect(log(page).getByRole('button', { name: W.suggestRisk, exact: true })).toBeVisible();
    await expect(said(log(page), W.empty), 'not in the conversation').toHaveCount(0);
    expect(c.of('open'), 'no chat was read').toEqual([]);
  });

  test('AC-7 “No chats yet.” is not shown while the list loads, when it fails, when it is never answered, when Ask Batsi is off, when there are chats, or for a search with no match', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    // Loading: held, then shown once the empty list arrives.
    c.hold('list');
    c.seed(hr.email, []);
    await clockAt({ page, chats: c });
    await signedIn({ page, signIn, hr });
    await page.goto(FULL_PAGE);
    await expect.poll(() => c.of('list').length).toBe(1);
    await ensureList(page);
    await expect(nav(page).locator('[aria-busy="true"]').or(nav(page).and(page.locator('[aria-busy="true"]')))).not.toHaveCount(0);
    await expect(empty(page.locator('body')), 'not while loading').toHaveCount(0);
    c.release('list');
    await expect(empty(nav(page)), 'shown once the empty list has come').toBeVisible();
    // The list fails: a 500, a dropped connection, a 200 without a list.
    for (const mode of ['failed', 'dropped', 'nolist'] as const) {
      c.mode.list = mode;
      await page.reload();
      await ensureList(page);
      await expect(nav(page).getByText(W.loadFailed, { exact: true }), `${mode}: the load-failed line`).toBeVisible();
      await expect(empty(page.locator('body')), `${mode}: we do not say they have none`).toHaveCount(0);
    }
    c.mode.list = 'ok';
    // Switched off.
    c.on = false;
    await page.reload();
    await expect(said(log(page), W.notOn)).toBeVisible();
    await ensureList(page);
    await expect(entry(page, W.deleteAll)).toBeVisible();
    await expect(empty(page.locator('body')), 'switched off').toHaveCount(0);
    c.on = true;
    // With chats, and a search with no match.
    c.seed(hr.email, FOUR());
    await page.reload();
    await ensureList(page);
    await expect(entry(page, T.payroll)).toBeVisible();
    await expect(empty(page.locator('body')), 'with chats').toHaveCount(0);
    await entry(page, W.search).click();
    await searchBox(page).fill('zzz');
    await expect(nav(page).getByText(W.noMatch, { exact: true })).toBeVisible();
    await expect(empty(page.locator('body')), 'a search with no match says “No chats found.” only').toHaveCount(0);
    // A list that is never answered at all is AC-21's case.
  });

  test('AC-8 “No chats yet.” is never in the side panel: not when the panel opens first, not after the full page showed it, not after Open as a full page and back', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.seed(hr.email, []);
    await clockAt({ page, chats: c });
    await signedIn({ page, signIn, hr });
    // The panel first, before the full page was ever opened.
    await askButton(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole('log')).toBeVisible();
    await page.waitForTimeout(800);
    await expect(empty(panel(page)), 'not in the panel').toHaveCount(0);
    expect(await screenText(page), 'nowhere on the screen while the panel is open').not.toContain(W.empty);
    // Open as a full page: the sentence is in the column only.
    await panel(page).getByRole('button', { name: 'Open as a full page', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${FULL_PAGE}$`));
    await ensureList(page);
    await expect(empty(nav(page))).toBeVisible();
    await expect(empty(page.locator('body')), 'once, in the column').toHaveCount(1);
    await expect(empty(log(page)), 'not in the conversation').toHaveCount(0);
    // Back to Today and the panel again: still not there.
    await closeList(page);
    await backLink(page).click();
    await expect(page).toHaveURL(/\/hr$/);
    await askButton(page).click();
    await expect(panel(page)).toBeVisible();
    await page.waitForTimeout(800);
    await expect(empty(panel(page)), 'not in the panel after the full page showed it').toHaveCount(0);
    expect(await screenText(page), 'nowhere on the screen').not.toContain(W.empty);
    // A question in the panel, then the panel still has no sentence.
    c.reply = () => 'Answered in the panel.';
    await composer(page).fill('Anything waiting?');
    await sendButton(page).click();
    await expect(said(panel(page).getByRole('log'), 'Answered in the panel.')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(empty(panel(page))).toHaveCount(0);
    expect(await screenText(page)).not.toContain(W.empty);
  });

  test('AC-9 After Delete all my chats the list says “No chats yet.”, Delete all my chats is gone and the chat is a new one', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await arrive({ page, signIn, hr, chats: c });
    await expect(heading(page)).toHaveText(T.last);
    await ensureList(page);
    await entry(page, W.deleteAll).click();
    await allDialog(page).getByRole('button', { name: W.deleteAll, exact: true }).click();
    await expect(allDialog(page)).toHaveCount(0);
    expect(c.of('delete-all')).toHaveLength(1);
    await ensureList(page);
    await expect(empty(nav(page))).toBeVisible();
    await expect(entry(page, W.deleteAll)).toHaveCount(0);
    await closeList(page);
    await expect(heading(page)).toHaveText(W.newChat);
  });
});

// ================================================================ AC-10 to AC-19: the last chat on arrival

test.describe('The last chat on arrival', () => {
  test('AC-10 Loading the full page opens the most recently updated chat once the list answers: one read of that chat, after the list; its title as the heading, its messages, its row current, Delete chat; no greeting or suggestions; a reload does it again', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await arrive({ page, signIn, hr, chats: c });
    await expect(heading(page)).toHaveText(T.last);
    await expect(said(log(page), LAST_SAID)).toBeVisible();
    await expect(said(log(page), 'Who in finance has leave left?')).toBeVisible();
    await expect(said(log(page), W.hello), 'no greeting: this is an old chat').toHaveCount(0);
    await expect(log(page).getByRole('button', { name: W.suggestRisk, exact: true }), 'no suggested questions').toHaveCount(0);
    const reads = c.of('open');
    expect(reads.map((r) => r.chatId), 'one read, of the most recently updated chat').toEqual([chatId(7)]);
    expect(reads[0]!.method).toBe('GET');
    const firstList = c.of('list')[0]!;
    expect(reads[0]!.seq, 'read after the list').toBeGreaterThan(firstList.seq);
    expect(c.asks(), 'nothing asked').toEqual([]);
    await expect(page, 'the address stays the same').toHaveURL(new RegExp(`${FULL_PAGE}$`));
    await ensureList(page);
    await expect(entry(page, T.last)).toHaveAttribute('aria-current', 'page');
    for (const t of [T.payroll, T.banks, T.starters]) await expect(entry(page, t)).not.toHaveAttribute('aria-current', 'page');
    await closeList(page);
    await expect(headerDelete(page), 'a stored chat: Delete chat shows').toBeVisible();
    // A reload does the same, with one more read.
    await page.reload();
    await expect(heading(page)).toHaveText(T.last);
    await expect(said(log(page), LAST_SAID)).toBeVisible();
    await page.waitForTimeout(500);
    expect(c.of('open').map((r) => r.chatId), 'one read per load').toEqual([chatId(7), chatId(7)]);
  });

  test('AC-11 The chat comes from the list, not from the browser: a chat opened by hand is not the one a reload opens; when another chat becomes the newest on the server, a reload opens that one; nothing is kept in the browser', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await arrive({ page, signIn, hr, chats: c });
    await expect(heading(page)).toHaveText(T.last);
    await ensureList(page);
    await entry(page, T.banks).click();
    await expect(heading(page)).toHaveText(T.banks);
    await page.reload();
    await expect(heading(page), 'the reload opens the newest chat, not the one last looked at').toHaveText(T.last);
    // Somewhere else the person asked in "Bank letters…": it is the newest now.
    c.seed(hr.email, FOUR().map((x) => (x.chatId === chatId(3) ? { ...x, updated: sast('2026-11-19', '17:30') } : x)));
    await page.reload();
    await expect(heading(page), 'the newest on the server').toHaveText(T.banks);
    await page.waitForTimeout(300);
    const box = await kept(page);
    for (const m of [T.last, T.banks, T.payroll, LAST_SAID, chatId(7), chatId(3), 'Leave balances', 'Bank letters']) expect(box, `the browser keeps no "${m}"`).not.toContain(m);
  });

  test('AC-12 The first page of the list is enough: with 120 chats and the second page held back, the newest chat opens', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.hold('list-next');
    await arrive({ page, signIn, hr, chats: c }, MANY(120));
    await expect(heading(page), 'the newest chat opens while page two is on its way').toHaveText('Chat number 001');
    await expect.poll(() => c.of('list-next').length).toBeGreaterThan(0);
    expect(c.of('open').map((r) => r.chatId)).toEqual([chatId(100)]);
    c.release('list-next');
  });

  test('AC-13 Nothing to open: switched off shows the not-switched-on message; a list that fails stays on a new chat, also after Try again; no chat is read', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.on = false;
    await arrive({ page, signIn, hr, chats: c });
    await expect(said(log(page), W.notOn)).toBeVisible();
    await expect(said(log(page), W.notOnNext)).toBeVisible();
    await expect(composer(page), 'the message box is off').toBeDisabled();
    await page.waitForTimeout(400);
    expect(c.of('open'), 'switched off: no chat read').toEqual([]);
    // The list fails, then Try again brings it: the page stays on the new chat.
    c.on = true;
    c.mode.list = 'failed';
    await page.reload();
    await ensureList(page);
    await expect(nav(page).getByText(W.loadFailed, { exact: true })).toBeVisible();
    c.mode.list = 'ok';
    await nav(page).getByRole('button', { name: W.retry, exact: true }).or(nav(page).getByRole('link', { name: W.retry, exact: true })).click();
    await expect(entry(page, T.last)).toBeVisible();
    await page.waitForTimeout(600);
    await closeList(page);
    await expect(heading(page), 'still the new chat after Try again').toHaveText(W.newChat);
    await expect(said(log(page), W.hello)).toBeVisible();
    expect(c.of('open'), 'no chat read').toEqual([]);
  });

  test('AC-14 New chat still starts a blank chat after the last chat opened, and it stays blank: greeting, suggestions, heading "New chat", focus in the message box, nothing sent, no second opening', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await arrive({ page, signIn, hr, chats: c });
    await expect(heading(page)).toHaveText(T.last);
    const sent = c.calls.length;
    await ensureList(page);
    await entry(page, W.newChat).click();
    await expect(heading(page)).toHaveText(W.newChat);
    await expect(said(log(page), W.hello)).toBeVisible();
    await expect(log(page).getByRole('button', { name: W.suggestRisk, exact: true })).toBeVisible();
    await expect(said(log(page), LAST_SAID)).toHaveCount(0);
    await expect(composer(page)).toBeFocused();
    await page.waitForTimeout(1000);
    await expect(heading(page), 'it stays a new chat').toHaveText(W.newChat);
    expect(c.calls.slice(sent).filter((x) => x.route !== 'pending'), 'nothing is sent by pressing New chat').toEqual([]);
    expect(c.of('open'), 'only the one opening on arrival').toHaveLength(1);
    // The first question in it starts a new chat (no chat id), and the page does not jump to another chat after the answer.
    c.reply = () => 'A new answer.';
    await ask(page, 'A fresh question');
    await expect(said(log(page), 'A new answer.')).toBeVisible();
    expect(c.asks()[0]!.body.chatId, 'a new chat: no chat id').toBeUndefined();
    await page.waitForTimeout(600);
    expect(c.of('open'), 'still only the one opening on arrival').toHaveLength(1);
  });

  test('AC-15 The person acts before the list answers: a question asked, or New chat pressed, keeps the page where the person is; the last chat is not opened over it', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.reply = () => 'Answered while the list loads.';
    c.hold('list');
    c.seed(hr.email, FOUR());
    await clockAt({ page, chats: c });
    await signedIn({ page, signIn, hr });
    await page.goto(FULL_PAGE);
    await expect.poll(() => c.of('list').length).toBe(1);
    await ask(page, 'A question before the list');
    await expect(said(log(page), 'Answered while the list loads.')).toBeVisible();
    c.release('list');
    await ensureList(page);
    await expect(entry(page, T.last)).toBeVisible();
    await page.waitForTimeout(800);
    await closeList(page);
    await expect(said(log(page), 'Answered while the list loads.'), 'the person’s question and answer are still there').toBeVisible();
    await expect(heading(page)).not.toHaveText(T.last);
    expect(c.of('open').filter((x) => x.chatId === chatId(7)), 'the last chat was not opened over it').toEqual([]);
    // New chat pressed while the list loads.
    c.hold('list');
    await page.reload();
    await expect.poll(() => c.of('list').length).toBeGreaterThan(1);
    const opens = c.of('open').length;
    await ensureList(page);
    await entry(page, W.newChat).click();
    await expect(heading(page)).toHaveText(W.newChat);
    c.release('list');
    await ensureList(page);
    await expect(entry(page, T.last)).toBeVisible();
    await page.waitForTimeout(800);
    await closeList(page);
    await expect(heading(page), 'still the new chat the person asked for').toHaveText(W.newChat);
    expect(c.of('open').length, 'no chat read').toBe(opens);
  });

  test('AC-16 Open as a full page from the side panel keeps the panel’s chat: the last chat the panel opened stays, with no second read; a blank chat from New chat stays blank; the full page opens the last chat by itself only when the page itself is loaded', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.seed(hr.email, FOUR());
    await clockAt({ page, chats: c });
    await signedIn({ page, signIn, hr });
    await askButton(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(said(panelLog(page), LAST_SAID), 'the panel started on the last chat').toBeVisible();
    await panel(page).getByRole('button', { name: 'Open as a full page', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${FULL_PAGE}$`));
    await expect(heading(page), 'the panel’s chat, as a page').toHaveText(T.last);
    await expect(said(log(page), LAST_SAID)).toBeVisible();
    await page.waitForTimeout(800);
    expect(c.of('open').map((r) => r.chatId), 'one read only: the page did not read it again').toEqual([chatId(7)]);
    // Back to Today, New chat in the panel, then Open as a full page: the blank chat stays blank.
    await closeList(page);
    await backLink(page).click();
    await expect(page).toHaveURL(/\/hr$/);
    await askButton(page).click();
    await expect(said(panelLog(page), LAST_SAID), 'the same chat in the panel').toBeVisible();
    await panelNewChat(page).click();
    await expect(said(panelLog(page), W.hello)).toBeVisible();
    await panel(page).getByRole('button', { name: 'Open as a full page', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${FULL_PAGE}$`));
    await ensureList(page);
    await expect(entry(page, T.last), 'the list has come').toBeVisible();
    await page.waitForTimeout(800);
    await closeList(page);
    await expect(heading(page), 'the panel’s blank chat, as a page').toHaveText(W.newChat);
    await expect(said(log(page), W.hello)).toBeVisible();
    expect(c.of('open'), 'no second read').toHaveLength(1);
    // Loading the page itself (a reload): the last chat.
    await page.reload();
    await expect(heading(page)).toHaveText(T.last);
    expect(c.of('open').map((r) => r.chatId)).toEqual([chatId(7), chatId(7)]);
    // A fresh visit, the panel opened, and Open as a full page pressed before the list answers: the panel's blank chat stays, nothing is read.
    await page.goto('/hr');
    await expect(askButton(page)).toBeVisible();
    c.hold('list');
    const lists = c.listReads().length;
    await openPanel(page);
    await expect.poll(() => c.listReads().length).toBeGreaterThan(lists);
    await panel(page).getByRole('button', { name: 'Open as a full page', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${FULL_PAGE}$`));
    c.release('list');
    await ensureList(page);
    await expect(entry(page, T.last), 'the list has come').toBeVisible();
    await page.waitForTimeout(800);
    await closeList(page);
    await expect(heading(page), 'still the panel’s blank chat').toHaveText(W.newChat);
    expect(c.of('open'), 'nothing more read').toHaveLength(2);
  });

  test('AC-17 The last chat cannot be opened: a 500 shows “We could not open this chat.” and Try again (the row current, no Delete chat); a 404 reads the list again and shows a new chat, with no second opening; a 403 shows the not-switched-on message', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.script('open', 'failed');
    await arrive({ page, signIn, hr, chats: c });
    await expect(log(page).getByRole('alert')).toHaveText(W.openFailed);
    await expect(log(page).getByRole('button', { name: W.retry, exact: true })).toBeVisible();
    await expect(headerDelete(page)).toHaveCount(0);
    expect(await screenText(page)).not.toMatch(/\b(500|502|404)\b|Something went wrong|0xDEAD|internal failure/i);
    await ensureList(page);
    await expect(entry(page, T.last), 'the row is current').toHaveAttribute('aria-current', 'page');
    await closeList(page);
    await log(page).getByRole('button', { name: W.retry, exact: true }).click();
    await expect(said(log(page), LAST_SAID)).toBeVisible();
    expect(c.of('open')).toHaveLength(2);
    // Gone (404): the list is read again and the page shows a new chat; it does not try the next chat.
    c.deleteBehind(hr.email, chatId(7));
    c.script('open', 'notfound');
    await page.reload();
    await expect.poll(() => c.of('open').length).toBe(3);
    await expect(heading(page)).toHaveText(W.newChat);
    await expect(said(log(page), W.hello)).toBeVisible();
    await page.waitForTimeout(800);
    expect(c.of('open'), 'no second opening').toHaveLength(3);
    // Switched off between the list and the opening (403 on the chat).
    c.script('open', 'forbidden');
    await page.reload();
    await expect(said(log(page), W.notOn)).toBeVisible();
    await expect(said(log(page), W.notOnNext)).toBeVisible();
  });

  test('AC-18 The opening does not move focus: what the person was on keeps focus', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.hold('list');
    c.seed(hr.email, FOUR());
    await clockAt({ page, chats: c });
    await signedIn({ page, signIn, hr });
    await page.goto(FULL_PAGE);
    await expect.poll(() => c.of('list').length).toBe(1);
    await composer(page).focus();
    await expect(composer(page)).toBeFocused();
    c.release('list');
    await expect(heading(page)).toHaveText(T.last);
    await expect(said(log(page), LAST_SAID)).toBeVisible();
    await page.waitForTimeout(400);
    await expect(composer(page), 'focus stayed in the message box').toBeFocused();
    if (!isPhone(page)) {
      c.hold('list');
      await page.reload();
      await expect.poll(() => c.of('list').length).toBe(2);
      await entry(page, W.search).focus();
      c.release('list');
      await expect(heading(page)).toHaveText(T.last);
      await page.waitForTimeout(400);
      await expect(entry(page, W.search), 'focus stayed on Search chats').toBeFocused();
    }
  });

  test('AC-19 Phone: on arrival the last chat fills the screen; the list stays closed; Back to Today, the title and Delete chat are on screen and clear of the top bar; the message box is above the bottom edge; no sideways scroll', async ({ page, signIn, hr, chats }, info) => {
    phoneOnly(info.project.name);
    noBackendOnly();
    await arrive({ page, signIn, hr, chats: chats! });
    await expect(heading(page)).toHaveText(T.last);
    await settled(page);
    expect(await listShown(page), 'the list is closed').toBe(false);
    await expectClearOfTopBar(page, backLink(page), 'Back to Today');
    await expectClearOfTopBar(page, heading(page), 'the title');
    await expectClearOfTopBar(page, headerDelete(page), 'Delete chat');
    const box = await rect(page.getByRole('form', { name: 'Message Batsi' }));
    const h = await page.evaluate(() => window.innerHeight);
    expect(box.bottom, 'the message box is above the bottom edge').toBeLessThanOrEqual(h + 0.5);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth), 'no sideways scroll').toBeLessThanOrEqual(1);
  });

  // AC-23 to AC-26 were found in the independent check of these tests (20 Nov 2026, gaps G1 to G4).

  test('AC-23 A question asked in the chat that opened by itself continues that chat: it carries that chat id, and the earlier messages stay', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await arrive({ page, signIn, hr, chats: c });
    await expect(heading(page)).toHaveText(T.last);
    await expect(said(log(page), LAST_SAID)).toBeVisible();
    c.reply = () => 'Continued.';
    await ask(page, 'And in sales?');
    await expect(said(log(page), 'Continued.')).toBeVisible();
    expect(c.asks(), 'one question').toHaveLength(1);
    expect(c.asks()[0]!.body.chatId, 'the same chat, not a new one').toBe(chatId(7));
    await expect(said(log(page), LAST_SAID), 'the earlier messages stay').toBeVisible();
    await expect(heading(page)).toHaveText(T.last);
  });

  test('AC-24 The chat that opened by itself is the one conversation: after Back to Today the side panel shows it', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await arrive({ page, signIn, hr, chats: c });
    await expect(heading(page)).toHaveText(T.last);
    await expect(said(log(page), LAST_SAID)).toBeVisible();
    await closeList(page);
    await backLink(page).click();
    await expect(page).toHaveURL(/\/hr$/);
    await askButton(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(said(panel(page).getByRole('log'), LAST_SAID), 'the panel shows the same chat').toBeVisible();
  });

  test('AC-25 The opening is not answered at all (the connection drops): “We could not open this chat.” with Try again, not a quiet new chat', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.script('open', 'dropped');
    await arrive({ page, signIn, hr, chats: c });
    await expect(log(page).getByRole('alert')).toHaveText(W.openFailed);
    await expect(log(page).getByRole('button', { name: W.retry, exact: true })).toBeVisible();
    await expect(said(log(page), W.hello), 'not a new chat').toHaveCount(0);
    await log(page).getByRole('button', { name: W.retry, exact: true }).click();
    await expect(said(log(page), LAST_SAID)).toBeVisible();
  });

  test('AC-26 The chat was deleted elsewhere between the list and the opening (404): the list is read again, the gone chat leaves it, and the page shows a new chat', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    c.hold('open');
    await arrive({ page, signIn, hr, chats: c });
    await expect.poll(() => c.of('open').length).toBe(1);
    const readsBefore = c.listReads().length;
    c.deleteBehind(hr.email, chatId(7));
    c.release('open');
    await expect(heading(page)).toHaveText(W.newChat);
    await expect.poll(() => c.listReads().length, { message: 'the list is read again' }).toBeGreaterThan(readsBefore);
    await ensureList(page);
    await expect(entry(page, T.last), 'the gone chat leaves the list').toHaveCount(0);
    for (const t of [T.payroll, T.banks, T.starters]) await expect(entry(page, t)).toBeVisible();
    await page.waitForTimeout(500);
    expect(c.of('open'), 'no second opening').toHaveLength(1);
  });
});

// ================================================================ AC-27 to AC-31: the side panel matches the full page
// Iggie, 20 Nov 2026 18:50 SAST ("Match full page"): the side panel starts on his last chat and has a New chat button, like the full page.

/** Signs in on Today with the person's chats seeded; the panel is not open yet. */
async function onToday(s: Setup, stored: StoredChat[] = FOUR()): Promise<void> {
  s.chats.seed(s.hr.email, stored);
  await clockAt(s);
  await signedIn(s);
}
async function openPanel(page: Page): Promise<void> {
  await askButton(page).click();
  await expect(panel(page)).toBeVisible();
}
const focusedName = (page: Page): Promise<string> => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  return a ? `${a.tagName}|${a.getAttribute('aria-label') ?? ''}|${(a.textContent ?? '').trim().slice(0, 40)}` : '';
});

test.describe('The side panel matches the full page', () => {
  test('AC-27 On a fresh visit the side panel opened from Today starts on the last chat: one read of the newest chat, after the list; its messages, no greeting or suggestions; the address stays; the opening does not move focus; closed and opened again, nothing is read again', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onToday({ page, signIn, hr, chats: c });
    expect(c.of('open'), 'nothing is opened before the panel').toEqual([]);
    c.hold('list');
    await openPanel(page);
    await expect.poll(() => c.of('list').length).toBe(1);
    await page.waitForTimeout(300);
    const before = await focusedName(page);
    c.release('list');
    await expect(said(panelLog(page), LAST_SAID)).toBeVisible();
    await expect(said(panelLog(page), 'Who in finance has leave left?')).toBeVisible();
    await expect(said(panelLog(page), W.hello), 'no greeting: this is an old chat').toHaveCount(0);
    await expect(panel(page).getByRole('button', { name: W.suggestRisk, exact: true }), 'no suggested questions').toHaveCount(0);
    await page.waitForTimeout(400);
    expect(await focusedName(page), 'the opening did not move focus').toBe(before);
    const reads = c.of('open');
    expect(reads.map((r) => r.chatId), 'one read, of the most recently updated chat').toEqual([chatId(7)]);
    expect(reads[0]!.seq, 'read after the list').toBeGreaterThan(c.of('list')[0]!.seq);
    expect(c.asks(), 'nothing asked').toEqual([]);
    await expect(page, 'the address stays on Today').toHaveURL(/\/hr$/);
    // Closed and opened again: the same chat, nothing read again.
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await openPanel(page);
    await expect(said(panelLog(page), LAST_SAID)).toBeVisible();
    await page.waitForTimeout(500);
    expect(c.of('open'), 'no second read').toHaveLength(1);
    expect(c.of('list'), 'no second list read').toHaveLength(1);
    // A question continues that chat.
    c.reply = () => 'Continued in the panel.';
    await composer(page).fill('And in sales?');
    await sendButton(page).click();
    await expect(said(panelLog(page), 'Continued in the panel.')).toBeVisible();
    expect(c.asks()[0]!.body.chatId, 'the same chat').toBe(chatId(7));
  });

  test('AC-28 The side panel has one “New chat” button, plain words from the full page, on screen; pressed, it starts a blank chat: greeting, suggestions, focus in the message box; the next question has no chat id; closed and opened again it stays blank', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onToday({ page, signIn, hr, chats: c });
    await openPanel(page);
    await expect(said(panelLog(page), LAST_SAID)).toBeVisible();
    await expect(panelNewChat(page)).toHaveCount(1);
    await expect(panelNewChat(page)).toBeVisible();
    await expect(panelNewChat(page)).toHaveText(W.newChat);
    const b = await rect(panelNewChat(page));
    const w = await page.evaluate(() => window.innerWidth);
    expect(b.left, 'on screen').toBeGreaterThanOrEqual(0);
    expect(b.right, 'on screen').toBeLessThanOrEqual(w + 0.5);
    await panelNewChat(page).click();
    await expect(said(panelLog(page), W.hello)).toBeVisible();
    await expect(said(panelLog(page), LAST_SAID), 'the old chat is gone from the panel').toHaveCount(0);
    await expect(panel(page).getByRole('button', { name: W.suggestRisk, exact: true })).toBeVisible();
    await expect(composer(page), 'focus in the message box').toBeFocused();
    expect(c.asks(), 'nothing sent').toEqual([]);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await openPanel(page);
    await page.waitForTimeout(600);
    await expect(said(panelLog(page), W.hello), 'still the blank chat').toBeVisible();
    await expect(said(panelLog(page), LAST_SAID)).toHaveCount(0);
    expect(c.of('open'), 'no second opening').toHaveLength(1);
    c.reply = () => 'A new thread.';
    await composer(page).fill('Anything waiting?');
    await sendButton(page).click();
    await expect(said(panelLog(page), 'A new thread.')).toBeVisible();
    expect(c.asks()[0]!.body.chatId, 'a new chat: no chat id').toBeUndefined();
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth), 'no sideways scroll').toBeLessThanOrEqual(1);
  });

  test('AC-29 The person comes first in the panel: a question asked, or New chat pressed, before the list answers keeps the panel where the person is; a chat on screen already (picked on the full page) is kept; the last chat is not opened over any of them', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    // A question before the list answers.
    await onToday({ page, signIn, hr, chats: c });
    c.hold('list');
    await openPanel(page);
    await expect.poll(() => c.of('list').length).toBe(1);
    c.reply = () => 'Asked first.';
    await composer(page).fill('Anything waiting?');
    await sendButton(page).click();
    await expect(said(panelLog(page), 'Asked first.')).toBeVisible();
    c.release('list');
    await page.waitForTimeout(800);
    await expect(said(panelLog(page), 'Asked first.')).toBeVisible();
    await expect(said(panelLog(page), LAST_SAID)).toHaveCount(0);
    expect(c.of('open'), 'no chat read').toEqual([]);
    // New chat pressed before the list answers (a fresh load of Today).
    c.hold('list');
    await page.goto('/hr');
    await expect(askButton(page)).toBeVisible();
    await openPanel(page);
    await expect.poll(() => c.listReads().length).toBeGreaterThan(1);
    await panelNewChat(page).click();
    c.release('list');
    await page.waitForTimeout(800);
    await expect(said(panelLog(page), W.hello)).toBeVisible();
    await expect(said(panelLog(page), LAST_SAID)).toHaveCount(0);
    expect(c.of('open'), 'no chat read').toEqual([]);
    // A chat picked by hand on the full page, then Back to Today: the panel keeps it, nothing new is read.
    c.seed(hr.email, FOUR()); // the question above was stored as a new chat; start again from the four
    await page.goto(FULL_PAGE);
    await expect(heading(page)).toHaveText(T.last);
    await ensureList(page);
    await entry(page, T.banks).click();
    await expect(heading(page)).toHaveText(T.banks);
    const opens = c.of('open').length;
    await closeList(page);
    await backLink(page).click();
    await expect(page).toHaveURL(/\/hr$/);
    await openPanel(page);
    await page.waitForTimeout(800);
    await expect(said(panelLog(page), LAST_SAID), 'not switched to the newest chat').toHaveCount(0);
    expect(c.of('open'), 'nothing read again').toHaveLength(opens);
    await expect(panelNewChat(page)).toBeVisible();
  });

  test('AC-30 Nothing to open in the panel: an empty list or a list that fails leaves the greeting and suggestions, with no error and no “No chats yet.”, and New chat still shows; switched off shows the not-switched-on message with no New chat; an opening that fails shows “We could not open this chat.” and Try again; a gone chat (404) gives a blank chat', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    // Empty.
    await onToday({ page, signIn, hr, chats: c }, []);
    await openPanel(page);
    await expect.poll(() => c.of('list').length).toBe(1);
    await page.waitForTimeout(500);
    await expect(said(panelLog(page), W.hello)).toBeVisible();
    await expect(panel(page).getByRole('button', { name: W.suggestRisk, exact: true })).toBeVisible();
    expect(await screenText(page)).not.toContain(W.empty);
    await expect(panelNewChat(page)).toBeVisible();
    expect(c.of('open')).toEqual([]);
    // The list fails.
    c.seed(hr.email, FOUR());
    c.script('list', 'failed');
    await page.goto('/hr');
    await openPanel(page);
    await expect.poll(() => c.of('list').length).toBe(2);
    await page.waitForTimeout(500);
    await expect(said(panelLog(page), W.hello)).toBeVisible();
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    expect(await screenText(page)).not.toMatch(/\b(500|502|404)\b|Something went wrong|0xDEAD|internal failure|No chats yet\./i);
    await expect(panelNewChat(page)).toBeVisible();
    expect(c.of('open')).toEqual([]);
    // The opening fails (500), then Try again.
    c.script('open', 'failed');
    await page.goto('/hr');
    await openPanel(page);
    await expect(panelLog(page).getByRole('alert')).toHaveText(W.openFailed);
    await panelLog(page).getByRole('button', { name: W.retry, exact: true }).click();
    await expect(said(panelLog(page), LAST_SAID)).toBeVisible();
    // Gone (404): a blank chat, no second opening.
    c.script('open', 'notfound');
    await page.goto('/hr');
    const opens = c.of('open').length;
    await openPanel(page);
    await expect.poll(() => c.of('open').length).toBe(opens + 1);
    await page.waitForTimeout(800);
    await expect(said(panelLog(page), W.hello)).toBeVisible();
    expect(c.of('open'), 'no second opening').toHaveLength(opens + 1);
    // Switched off.
    c.on = false;
    await page.goto('/hr');
    await openPanel(page);
    await expect(said(panelLog(page), W.notOn)).toBeVisible();
    await expect(panelNewChat(page), 'no New chat when switched off (as the full page)').toHaveCount(0);
  });

  test('AC-31 Nothing is read before the panel opens: on Today without the panel no list and no chat is read', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    await onToday({ page, signIn, hr, chats: c });
    await page.waitForTimeout(1500);
    expect(c.listReads(), 'no list read on Today without the panel').toEqual([]);
    expect(c.of('open'), 'no chat read').toEqual([]);
  });
});

// ================================================================ AC-20: another person on the same browser

test.describe('Private data', () => {
  test('AC-20 Person A’s last chat is still being read when A signs out; person B (another company) signs in on the same browser: A’s late answer never shows, B’s page opens on B’s own last chat, every chats call carries B’s token', async ({ page, signIn, hr, chats, cognito }) => {
    noBackendOnly();
    const c = chats!;
    const B = { email: 'kgosi.dlamini@zulu-foods.co.za', givenName: 'Kgosi', familyName: 'Dlamini', groups: ['hr_staff'] };
    cognito!.addAccount(B);
    const bLogin: Login = { email: B.email, password: hr.password, givenName: B.givenName } as Login;
    c.seed(B.email, [chat(51, 'Zulu Foods payroll run', sast('2026-11-19', '14:00'), [
      { role: 'person', text: 'Is the Zulu payroll ready?', at: sast('2026-11-19', '14:00') },
      { role: 'batsi', text: 'The Zulu payroll is ready.', at: sast('2026-11-19', '14:00') },
    ])]);
    c.hold('open', hr.email);
    await arrive({ page, signIn, hr, chats: c });
    await expect.poll(() => c.of('open').filter((x) => x.email === hr.email.toLowerCase()).length, { message: 'A’s last chat is being read (held)' }).toBe(1);
    const A_WORDS = [T.last, LAST_SAID, 'Who in finance has leave left?', T.payroll, T.banks];
    const seenBefore = c.calls.length;
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await signIn.signInAs(bLogin);
    await expect(page).toHaveURL(/\/hr$/);
    const hits = await watchFor(page, A_WORDS);
    // B opens the panel (same page load): it starts on B's own last chat. Then B goes to the full page, and A's held read is answered now.
    await askButton(page).click();
    await expect(said(panelLog(page), 'The Zulu payroll is ready.'), 'the panel starts on B’s own last chat').toBeVisible();
    await panel(page).getByRole('button', { name: 'Open as a full page', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${FULL_PAGE}$`));
    await ensureList(page);
    await expect(entry(page, 'Zulu Foods payroll run')).toBeVisible();
    c.release('open', hr.email);
    await page.waitForTimeout(800);
    expect(await hits(), 'at no moment did any of A’s words show').toEqual([]);
    await closeList(page);
    await expect(heading(page), 'B came in through the panel: the panel’s chat, B’s own').toHaveText('Zulu Foods payroll run');
    // B loads the page: B's own last chat opens.
    await page.reload();
    await expect(heading(page), 'B’s own last chat').toHaveText('Zulu Foods payroll run');
    await expect(said(log(page), 'The Zulu payroll is ready.')).toBeVisible();
    expect(await screenText(page)).not.toMatch(new RegExp(A_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')));
    const after = c.calls.slice(seenBefore).filter((x) => x.route !== 'pending');
    expect(after.length).toBeGreaterThan(0);
    expect(after.map((x) => x.email), 'every chats call after sign-out carries B’s token').toEqual(after.map(() => B.email.toLowerCase()));
    expect(c.of('open').filter((x) => x.email === B.email.toLowerCase()).map((x) => x.chatId), 'the panel’s read and the reload’s read, both B’s').toEqual([chatId(51), chatId(51)]);
  });
});

// ================================================================ AC-21, AC-22: older cards, no AI

test.describe('Older cards and no AI', () => {
  test('AC-21 Where /v1/chats is not answered (CHAT-01’s fake only) the page loads on a new chat and stays usable: the greeting, asking works, no chat is read', async ({ page, signIn, hr, context, baseURL }) => {
    noBackendOnly();
    const old = new ChatFake(new URL(baseURL!).origin);
    old.reply = () => ({ message: 'Answered by the old fake.' });
    await old.install(context);
    const seen: string[] = [];
    page.on('request', (r) => seen.push(`${r.method()} ${new URL(r.url()).pathname}`));
    await signedIn({ page, signIn, hr });
    await page.goto(FULL_PAGE);
    await expect(composer(page)).toBeVisible();
    await expect(heading(page)).toHaveText(W.newChat);
    await expect(said(log(page), W.hello)).toBeVisible();
    await ensureList(page);
    await expect(nav(page).getByText(W.loadFailed, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(empty(page.locator('body')), 'no answer is not an empty list: no “No chats yet.”').toHaveCount(0);
    await closeList(page);
    await ask(page, 'First question');
    await expect(said(log(page), 'Answered by the old fake.')).toBeVisible();
    expect(seen.filter((x) => /^GET \/v1\/chats\/./.test(x)), 'no chat read').toEqual([]);
  });

  test('AC-22 A whole visit (arrival with the last chat, the list, New chat, a question) reaches no AI host', async ({ page, signIn, hr, chats }) => {
    noBackendOnly();
    const c = chats!;
    const seen: string[] = [];
    page.on('request', (r) => seen.push(r.url()));
    c.reply = () => 'Fake answer.';
    await arrive({ page, signIn, hr, chats: c });
    await expect(heading(page)).toHaveText(T.last);
    await ensureList(page);
    await entry(page, W.newChat).click();
    await ask(page, 'A question');
    await expect(said(log(page), 'Fake answer.')).toBeVisible();
    const ai = seen.filter((u) => /bedrock|textract|anthropic\.com|openai\.com|generativelanguage|api\.cohere|mistral\.ai/i.test(u));
    expect(ai, 'no request to an AI host').toEqual([]);
    expect(c.asks()).toHaveLength(1);
  });
});
