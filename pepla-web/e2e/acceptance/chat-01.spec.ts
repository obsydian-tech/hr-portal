import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { DocumentsFake, storedEmployee, type FakePerson } from './support/documents-fake';
import { EmployeesFake } from './support/employees-fake';
import { ChatFake, ROWS, SAID, type ChatProposal, type ChatReply } from './support/chat-01/chat-fake';
import { FAKE, ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { forgetSignIn } from './support/sign-in-again';

/**
 * CHAT-01 · Ask Batsi chat: the top bar button, the side panel and the full page.
 * Spec: /mnt/project-files/ask-batsi-chat/CHAT-01-ask-batsi-chat.md (AC-1 to AC-18). Notes and the contract these tests fix
 * where the card is silent: cards/chat-01.md.
 *
 * In this card: AC-1, 2, 3 (who sees the button), 4 to 10, 12 (panel and full page, no list of chats), 13, 14, 17, 18.
 * Not in this card (CHAT-02, lock chat-01.1): AC-11, AC-15, AC-16, the list of chats on a phone (AC-12), "New chat",
 * Delete chat, and the per-company switch (the "company has it off" half of AC-3).
 *
 * Fake answers only: the Agent API is answered in the browser by support/chat-01/chat-fake.ts. No test calls Bedrock or any
 * paid AI; AC-17 shows it. The words are the approved sentences (words.json); "Pepla" never shows on a screen.
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

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake Agent API.');
const desktopOnly = (name: string) => test.skip(name !== 'desktop-1280', 'Runs once: it reads code, it has no screen width.');

const KAGISO: FakePerson = { employee: storedEmployee({ first_name: 'Kagiso', last_name: 'Molefe', job_title: 'Payroll Clerk', department: 'Finance' }), documents: [] };
const personPath = `/hr/employees/${KAGISO.employee.employee_id}`;
const FULL_PAGE = '/hr/ask-batsi';

/** The words, as approved (words.json). */
const W = {
  button: 'Ask Batsi',
  panel: 'Batsi',
  hint: 'Batsi changes nothing until you approve.',
  expand: 'Open as a full page',
  back: 'Back to Today',
  stopped: 'Stopped. Nothing was changed.',
  notOn: 'Ask Batsi is not switched on for your company.',
  notOnNext: 'Ask your administrator to switch it on.',
  error: 'I could not answer that. Try again in a few minutes.',
  retry: 'Try again',
  offline: 'You are offline. You can ask again when you are back online.',
  limit: (n: number) => `You have reached the hourly limit for questions. Try again in ${n} minutes.`,
  today: 'Looking at Today',
  looking: (name: string) => `Looking at ${name}`,
  placeholder: (first: string) => `Ask anything about ${first}`,
  hello: (first: string) => `Hi ${first}. Pick a question or ask me.`,
  s1: (first: string) => `Is ${first} ready to start on Monday?`,
  s2: 'Who hasn’t sent their documents?',
  s3: 'Which candidates are at risk?',
  suggested: 'Suggested by Batsi',
  proposalTitle: (first: string) => `Ask ${first} for his UIF reference number?`,
  draft: (first: string) => `Hi ${first}, please add your UIF reference number in your portal so we can finish your onboarding.`,
  waiting: (who: string) => `Waiting for ${who} to approve.`,
  onlyThem: (who: string) => `You asked for this. Only ${who} can approve it.`,
  approvedBy: (who: string) => `Approved by ${who}.`,
  audit: 'View in audit trail',
};
const WAITING_NAME = (n: number) => `Ask Batsi, ${n} waiting`;

// ---------------------------------------------------------------- things found by their words

const topBar = (page: Page): Locator => page.locator('.pp-top-navigation');
const askButton = (page: Page): Locator => page.getByRole('button', { name: /^Ask Batsi/ });
const panel = (page: Page): Locator => page.getByRole('dialog', { name: W.panel, exact: true });
const log = (page: Page): Locator => page.getByRole('log', { name: 'Conversation with Batsi' });
const composer = (page: Page): Locator => page.getByRole('textbox', { name: 'Message Batsi' });
const sendButton = (page: Page): Locator => page.getByRole('button', { name: 'Send', exact: true });
const stopButton = (page: Page): Locator => page.getByRole('button', { name: 'Stop', exact: true });
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Setup = { chat: ChatFake; docs: DocumentsFake; page: Page; signIn: SignInPage; hr: Login };

async function enter(page: Page, signIn: SignInPage, hr: Login): Promise<void> {
  await signIn.open();
  await signIn.signInAs(hr);
  await expect(page).toHaveURL(/\/hr$/);
  await expect(page.locator('main h1').first()).toBeVisible();
}

async function onPerson(s: Setup): Promise<void> {
  s.docs.add(KAGISO);
  await enter(s.page, s.signIn, s.hr);
  await s.page.goto(personPath);
  await expect(s.page.getByRole('heading', { level: 1, name: 'Kagiso Molefe' })).toBeVisible();
}

async function openPanel(page: Page): Promise<void> {
  await askButton(page).click();
  await expect(panel(page)).toBeVisible();
}

async function ask(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await sendButton(page).click();
}

const readyReply = (proposal?: ChatProposal): ChatReply => ({ message: SAID.ready, checks: ROWS, ...(proposal ? { proposals: [proposal] } : {}) });
const PROPOSAL: ChatProposal = { actionId: 'act-uif-1', title: W.proposalTitle('Kagiso'), draft: W.draft('Kagiso'), canApprove: true };

/** No "Pepla" on any screen the person sees (the public-names rule). */
async function expectNoPepla(page: Page): Promise<void> {
  const text = await page.locator('body').innerText();
  expect(text, 'no "Pepla" on the screen').not.toMatch(/pepla/i);
  expect(await page.title(), 'no "Pepla" in the tab title').not.toMatch(/pepla/i);
}

// ================================================================ AC-1

test.describe('AC-1 The top bar Ask Batsi button', () => {
  test('AC-1 HR sees the Ask Batsi button in the top bar of every page, with the count waiting, and no floating bubble', async ({ page, signIn, hr, chat, docs }) => {
    noBackendOnly();
    docs!.add(KAGISO);
    chat!.pending = [{ actionId: 'p1', title: 'One' }, { actionId: 'p2', title: 'Two' }];
    await enter(page, signIn, hr);
    // What waits is read when Ask Batsi is first opened (never on load: see cards/chat-01.md, rule 6), then every page shows it.
    await openPanel(page);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    for (const path of ['/hr', personPath, '/hr/documents']) {
      // Move inside the app (no reload), as a person does with the links.
      if (path !== '/hr') await page.evaluate((to) => { history.pushState({}, '', to); window.dispatchEvent(new PopStateEvent('popstate')); }, path);
      await expect(page).toHaveURL(new RegExp(`${esc(path)}$`));
      const button = askButton(page);
      await expect(button, `the button is on ${path}`).toHaveCount(1);
      await expect(topBar(page).getByRole('button', { name: /^Ask Batsi/ }), 'it is in the top bar').toBeVisible();
      await expect(button, 'two proposals wait: the button says so').toHaveAccessibleName(WAITING_NAME(2));
      await expect(topBar(page).getByText('2', { exact: true }), 'the count is drawn').toBeVisible();
    }
    // No floating bubble: nothing outside the top bar is an Ask Batsi opener.
    expect(await page.locator('button, a, [role="button"]').evaluateAll((els) =>
      els.filter((e) => /ask batsi/i.test((e.getAttribute('aria-label') ?? '') + ' ' + (e.textContent ?? '')) && !e.closest('.pp-top-navigation') && !e.closest('.pp-agent-panel')).length,
    ), 'no second way in').toBe(0);
    await expectNoPepla(page);
  });

  test('AC-1 With nothing waiting the button has no count; on a phone it is an icon with the same name', async ({ page, signIn, hr, chat }, info) => {
    noBackendOnly();
    chat!.pending = [];
    await enter(page, signIn, hr);
    const button = askButton(page);
    await expect(button).toHaveAccessibleName('Ask Batsi');
    await expect(topBar(page).locator('.pp-top-navigation__count, .pp-badge, [class*="count"]').filter({ hasText: /^\d+$/ }), 'no count').toHaveCount(0);
    const words = await button.getByText('Ask Batsi', { exact: true }).count();
    if (info.project.name === 'phone-390') {
      expect(words === 0 || !(await button.getByText('Ask Batsi', { exact: true }).first().isVisible()), 'on a phone the button is an icon only').toBe(true);
      const box = (await button.boundingBox())!;
      expect(box.width, 'a touch target').toBeGreaterThanOrEqual(40);
      expect(box.x + box.width, 'inside the screen').toBeLessThanOrEqual(390);
    } else {
      await expect(button.getByText('Ask Batsi', { exact: true }), 'on a desktop the words show').toBeVisible();
    }
  });

  test('AC-1 A failed read of what waits changes nothing: the button shows, no count, no error on screen', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await page.route(/\/agent\/v1\/actions\/pending$/, (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
    void chat;
    await enter(page, signIn, hr);
    await openPanel(page);
    await page.keyboard.press('Escape');
    await expect(askButton(page)).toHaveAccessibleName('Ask Batsi');
    expect(await page.locator('body').innerText()).not.toMatch(/boom|500|internal/i);
  });
});

test.describe('AC-1 No call until Ask Batsi is used', () => {
  test('AC-1 Signing in and moving about HR pages makes no Agent API call until Ask Batsi is opened', async ({ page, signIn, hr, chat, docs }) => {
    noBackendOnly();
    docs!.add(KAGISO);
    const agentRequests: string[] = [];
    page.on('request', (r) => { if (/\/agent\/v1\//.test(r.url())) agentRequests.push(`${r.method()} ${r.url()}`); });
    await enter(page, signIn, hr);
    await page.goto(personPath);
    await expect(page.getByRole('heading', { level: 1, name: 'Kagiso Molefe' })).toBeVisible();
    await page.goto('/hr/documents');
    await expect(askButton(page)).toBeVisible();
    expect(agentRequests, 'the shell asks the Agent API for nothing on its own (other cards’ tests forbid any other host)').toEqual([]);
    expect(chat!.calls).toHaveLength(0);
  });
});

// ================================================================ AC-2

test.describe('AC-2 The side panel', () => {
  test('AC-2 The button opens the panel, focus goes to the composer, Escape closes it and focus returns to the button', async ({ page, signIn, hr, chat, docs }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    const button = askButton(page);
    await button.click();
    await expect(panel(page)).toBeVisible();
    await expect(composer(page), 'focus is in the composer').toBeFocused();
    await expect(panel(page).getByText(W.today, { exact: true }), 'on a page with no person').toBeVisible();
    await expect(panel(page).getByText(W.hello('Jane'), { exact: true }), 'the first message').toBeVisible();
    await expect(panel(page).getByText(W.hint, { exact: true })).toBeVisible();
    await expect(panel(page).getByText(W.s2, { exact: true })).toBeVisible();
    await expect(panel(page).getByText(W.s3, { exact: true })).toBeVisible();
    await expectNoPepla(page);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(button, 'focus returns to the button').toBeFocused();
    expect(chat!.chats(), 'opening and closing asks nothing').toHaveLength(0);
    void docs;
  });

  test('AC-2 On a person the panel knows who: the context line, the composer words, the suggestion, and what the question carries', async ({ page, signIn, hr, chat, docs }) => {
    noBackendOnly();
    await onPerson({ chat: chat!, docs: docs!, page, signIn, hr });
    await openPanel(page);
    await expect(panel(page).getByText(W.looking('Kagiso Molefe'), { exact: true })).toBeVisible();
    await expect(composer(page)).toHaveAttribute('placeholder', W.placeholder('Kagiso'));
    await expect(panel(page).getByText(W.s1('Kagiso'), { exact: true })).toBeVisible();
    chat!.reply = () => ({ message: 'Nothing to report.' });
    await ask(page, 'Is Kagiso on track?');
    await expect(log(page).getByText('Nothing to report.')).toBeVisible();
    const call = chat!.chats()[0]!;
    expect(call.authorization, 'it carries the person’s sign-in').toMatch(/^Bearer eyJ/);
    expect(call.body.message).toBe('Is Kagiso on track?');
    expect(call.body.screenContext?.employeeId, 'it says which person the page is about').toBe(KAGISO.employee.employee_id);
    expect(typeof call.body.screenContext?.view, 'and which page').toBe('string');
    const sent = JSON.stringify(call.body).toLowerCase();
    expect(sent, 'the company never comes from the body').not.toMatch(/tenant|company/);
    expect(call.url.search, 'nor from the address').not.toMatch(/tenant|company/i);
    await expectNoPepla(page);
  });
});

// ================================================================ AC-3

test.describe('AC-3 Who may use it', () => {
  test('AC-3 An employee sees no Ask Batsi button and the full page is not theirs', async ({ page, signIn, employee, chat }) => {
    noBackendOnly();
    await signIn.open();
    await signIn.signInAs(employee);
    await expect(page).toHaveURL(/\/start/);
    await expect(askButton(page), 'no button for an employee').toHaveCount(0);
    await page.goto(FULL_PAGE);
    await expect(page).not.toHaveURL(new RegExp(`${esc(FULL_PAGE)}$`));
    await expect(composer(page), 'no chat').toHaveCount(0);
    expect(chat!.calls, 'nothing is asked of the Agent API').toHaveLength(0);
  });

  test('AC-3 Someone signed out who opens the full page is sent to sign in, not shown the chat', async ({ page, signIn, chat }) => {
    noBackendOnly();
    await page.goto(FULL_PAGE);
    await expect(signIn.email).toBeVisible();
    await expect(composer(page)).toHaveCount(0);
    expect(chat!.calls).toHaveLength(0);
  });

  test('AC-3 When the API refuses with 403 the panel says it is not switched on and shows no raw error', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await openPanel(page);
    chat!.mode = 'forbidden';
    await ask(page, 'Who is on leave?');
    await expect(log(page).getByText(W.notOn)).toBeVisible();
    await expect(log(page).getByText(W.notOnNext)).toBeVisible();
    const text = await page.locator('body').innerText();
    expect(text, 'no raw error').not.toMatch(/Forbidden|403|\{|"error"/);
    await expect(page.getByRole('alert').filter({ hasText: /forbidden|403/i })).toHaveCount(0);
  });
});

// ================================================================ AC-4

test.describe('AC-4 Working and Stop', () => {
  test('AC-4 A question shows the working line with Stop; Stop ends it with the approved words and a late answer never shows', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await openPanel(page);
    chat!.mode = 'hold';
    chat!.reply = () => ({ message: SAID.ready, checks: ROWS, proposals: [PROPOSAL] });
    await ask(page, 'Is Kagiso ready to start on Monday?');
    await expect(log(page).getByText('Is Kagiso ready to start on Monday?', { exact: true }), 'the question shows at once').toBeVisible();
    const working = log(page).getByRole('status');
    await expect(working).toBeVisible();
    expect(clean(await working.innerText()), 'the line says what Batsi is doing').toMatch(/^Batsi is \S/);
    await expect(stopButton(page)).toBeVisible();
    await stopButton(page).click();
    await expect(log(page).getByText(W.stopped, { exact: true })).toBeVisible();
    await expect(working).toBeHidden();
    chat!.release();
    await page.waitForTimeout(600);
    await expect(log(page).getByText(SAID.ready), 'the late answer is not shown').toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve' }), 'nor a proposal').toHaveCount(0);
    await expect(composer(page), 'the person can ask again').toBeEnabled();
    expect(chat!.decisions('approve'), 'nothing was changed').toHaveLength(0);
  });
});

// ================================================================ AC-5

test.describe('AC-5 An answer with checks', () => {
  test('AC-5 The one-line answer and the checks as rows, never raw JSON', async ({ page, signIn, hr, chat, docs }) => {
    noBackendOnly();
    await onPerson({ chat: chat!, docs: docs!, page, signIn, hr });
    await openPanel(page);
    chat!.reply = () => readyReply();
    await ask(page, W.s1('Kagiso'));
    await expect(log(page).getByText(SAID.ready, { exact: true })).toBeVisible();
    for (const r of ROWS) {
      const row = log(page).getByText(r.label, { exact: true });
      await expect(row, `row ${r.label}`).toBeVisible();
      const holder = row.locator('xpath=ancestor::*[self::li or @role="listitem" or contains(@class,"row") or contains(@class,"checklist")][1]');
      await expect(holder, `${r.label} shows ${r.result}`).toContainText(r.result);
    }
    const text = await log(page).innerText();
    expect(text, 'never raw JSON').not.toMatch(/[{}\[\]]|"label"|"result"|checks:/);
    await expect(log(page).locator('table'), 'not a table').toHaveCount(0);
    await expect(log(page).getByText('Missing', { exact: true })).toBeVisible();
    await expectNoPepla(page);
  });
});

// ================================================================ AC-6, AC-7

test.describe('AC-6 and AC-7 Proposals', () => {
  test('AC-6 A proposal is a card with Approve, Edit and Decline; Approve says who approved and when, links the audit trail and calls the API once', async ({ page, signIn, hr, chat, docs }) => {
    noBackendOnly();
    await onPerson({ chat: chat!, docs: docs!, page, signIn, hr });
    await openPanel(page);
    chat!.reply = () => readyReply(PROPOSAL);
    await ask(page, W.s1('Kagiso'));
    const card = log(page).locator('.pp-proposal, [class*="proposal"]').filter({ hasText: PROPOSAL.title }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText(W.suggested, { exact: false })).toBeVisible();
    await expect(card.getByText(PROPOSAL.draft, { exact: true })).toBeVisible();
    for (const name of ['Approve', 'Edit', 'Decline']) await expect(card.getByRole('button', { name, exact: true }), name).toBeVisible();
    await expect(askButton(page), 'the button counts the proposal').toHaveAccessibleName(WAITING_NAME(1));
    expect(chat!.decisions('approve'), 'nothing is approved before the click').toHaveLength(0);

    await card.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(card.getByText(W.approvedBy('Jane Smith'), { exact: false })).toBeVisible();
    await expect(card.locator('time'), 'with the time').toBeVisible();
    const link = card.getByRole('link', { name: W.audit });
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href'), 'the link goes somewhere').toBeTruthy();
    await expect(card.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
    const calls = chat!.decisions('approve');
    expect(calls, 'one approval').toHaveLength(1);
    expect(calls[0]!.path).toMatch(/\/agent\/v1\/actions\/act-uif-1\/approve$/);
    expect(calls[0]!.authorization, 'as that person').toMatch(/^Bearer eyJ/);
    expect(JSON.stringify(calls[0]!.body ?? {}).toLowerCase(), 'the company is not in the body').not.toMatch(/tenant|company/);
    expect(chat!.decisions('reject')).toHaveLength(0);
    await expect(askButton(page), 'nothing waits now').toHaveAccessibleName('Ask Batsi');
  });

  test('AC-6 Decline asks the API to reject and nothing is approved', async ({ page, signIn, hr, chat, docs }) => {
    noBackendOnly();
    await onPerson({ chat: chat!, docs: docs!, page, signIn, hr });
    await openPanel(page);
    chat!.reply = () => readyReply(PROPOSAL);
    await ask(page, W.s1('Kagiso'));
    const card = log(page).locator('.pp-proposal, [class*="proposal"]').filter({ hasText: PROPOSAL.title }).first();
    await card.getByRole('button', { name: 'Decline', exact: true }).click();
    await page.getByRole('button', { name: 'Decline proposal' }).click();
    await expect.poll(() => chat!.decisions('reject').length).toBe(1);
    expect(chat!.decisions('reject')[0]!.path).toMatch(/\/actions\/act-uif-1\/reject$/);
    expect(chat!.decisions('approve')).toHaveLength(0);
    await expect(card.getByText('Declined', { exact: false }).first()).toBeVisible();
    await expect(card.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
  });

  test('AC-7 A proposal the asker may not approve says who must, and has no Approve button', async ({ page, signIn, hr, chat, docs }) => {
    noBackendOnly();
    await onPerson({ chat: chat!, docs: docs!, page, signIn, hr });
    await openPanel(page);
    chat!.reply = () => readyReply({ ...PROPOSAL, actionId: 'act-int-9', title: 'Schedule an interview for Kagiso?', canApprove: false, approver: { name: 'Lerato Molefe' } });
    await ask(page, 'Book an interview for Kagiso');
    await expect(log(page).getByText(W.waiting('Lerato Molefe'), { exact: true })).toBeVisible();
    await expect(log(page).getByText(W.onlyThem('Lerato Molefe'), { exact: true })).toBeVisible();
    await expect(log(page).getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
    expect(chat!.decisions('approve')).toHaveLength(0);
    await expect(askButton(page), 'it does not wait for this person').toHaveAccessibleName('Ask Batsi');
  });
});

// ================================================================ AC-8, AC-9

test.describe('AC-8 and AC-9 Limits and personal details', () => {
  test('AC-8 Salary, legal and rating requests get the Limits reply, and no proposal', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await openPanel(page);
    chat!.reply = () => ({ message: SAID.outside });
    for (const q of ['What should we pay a senior driver?', 'Can I dismiss someone for being late?', 'Rate Kagiso’s performance out of ten']) {
      await ask(page, q);
      await expect(log(page).getByText(q, { exact: true })).toBeVisible();
    }
    await expect(log(page).getByText(SAID.outside, { exact: true })).toHaveCount(3);
    await expect(log(page).getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
    expect(chat!.chats()).toHaveLength(3);
  });

  test('AC-9 The screen shows what the API answered and never a stripped number; the Lambdas strip ID, phone and bank numbers', async ({ page, signIn, hr, chat }, info) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await openPanel(page);
    chat!.reply = () => ({ message: 'The ID is [SA-ID-REDACTED], the phone is [PHONE-REDACTED] and the account is [ACCOUNT-REDACTED].' });
    await ask(page, 'What are Kagiso’s details?');
    await expect(log(page).getByText('[SA-ID-REDACTED]', { exact: false })).toBeVisible();
    const text = await log(page).innerText();
    expect(text).not.toMatch(/\b\d{8,13}\b|\b0\d{9}\b|\+27\d{9}/);
    if (info.project.name !== 'desktop-1280') return;
    // Both chat Lambdas, run for real (no AWS call: the sanitiser is a pure function).
    const base = join(__dirname, '..', '..', '..', 'lambda');
    for (const lambda of ['nalekoAiChat', 'talentFlowAiChat']) {
      const mod = await import(pathToFileURL(join(base, lambda, 'pii-sanitiser.mjs')).href);
      const out = mod.sanitisePii('ID 9001015009087, phone 0825550142, also +27825550142, account 62012345678.');
      expect(out.sanitised, `${lambda} strips the ID number`).not.toContain('9001015009087');
      expect(out.sanitised, `${lambda} strips the phone numbers`).not.toMatch(/0825550142|27825550142/);
      expect(out.sanitised, `${lambda} strips the bank account`).not.toContain('62012345678');
      expect(out.fired).toBe(true);
    }
  });
});

// ================================================================ AC-10, AC-12 (panel and page)

async function expandFromPerson(s: Setup): Promise<void> {
  await onPerson(s);
  await openPanel(s.page);
  s.chat.reply = () => readyReply(PROPOSAL);
  await ask(s.page, W.s1('Kagiso'));
  await expect(log(s.page).getByText(SAID.ready, { exact: true })).toBeVisible();
  await panel(s.page).getByRole('button', { name: W.expand, exact: true }).click();
}

test.describe('AC-10 The full page', () => {
  test('AC-10 Expand opens the full page with the same conversation; Back to Today returns to the page the person was on', async ({ page, signIn, hr, chat, docs }) => {
    noBackendOnly();
    await expandFromPerson({ chat: chat!, docs: docs!, page, signIn, hr });
    await expect(page).toHaveURL(new RegExp(`${esc(FULL_PAGE)}$`));
    await expect(page.locator('.pp-agent-panel--page'), 'the page form of the panel').toBeVisible();
    await expect(panel(page), 'it is a page, not a dialog').toHaveCount(0);
    await expect(log(page).getByText(W.s1('Kagiso'), { exact: true }), 'the same question').toBeVisible();
    await expect(log(page).getByText(SAID.ready, { exact: true }), 'the same answer').toBeVisible();
    await expect(log(page).getByRole('button', { name: 'Approve', exact: true }), 'the same proposal').toBeVisible();
    expect(chat!.chats(), 'expanding asks nothing again').toHaveLength(1);
    await expectNoPepla(page);
    // Ask again on the page.
    chat!.reply = () => ({ message: 'Nothing else to report.' });
    await ask(page, 'Anything else?');
    await expect(log(page).getByText('Nothing else to report.')).toBeVisible();
    expect(chat!.chats()).toHaveLength(2);
    // Back.
    await page.getByRole('link', { name: W.back, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${esc(personPath)}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Kagiso Molefe' })).toBeVisible();
  });

  test('AC-10 Opened directly the full page works, and Back to Today goes to HR home', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await page.goto(FULL_PAGE);
    await expect(page.locator('.pp-agent-panel--page')).toBeVisible();
    await expect(composer(page)).toBeVisible();
    await expect(page.getByRole('link', { name: W.back, exact: true })).toBeVisible();
    chat!.reply = () => ({ message: 'Nothing to report.' });
    await ask(page, 'Hello');
    await expect(log(page).getByText('Nothing to report.')).toBeVisible();
    await page.getByRole('link', { name: W.back, exact: true }).click();
    await expect(page).toHaveURL(/\/hr$/);
    await expectNoPepla(page);
  });

  test('AC-10 Closing the panel keeps the conversation for the next time it opens, on the same page', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await openPanel(page);
    chat!.reply = () => ({ message: 'Nothing to report.' });
    await ask(page, 'Anything new?');
    await expect(log(page).getByText('Nothing to report.')).toBeVisible();
    await page.keyboard.press('Escape');
    await openPanel(page);
    await expect(log(page).getByText('Anything new?', { exact: true })).toBeVisible();
    await expect(log(page).getByText('Nothing to report.')).toBeVisible();
  });
});

test.describe('AC-12 On a phone (panel and page)', () => {
  test('AC-12 The panel is a full screen sheet: heading, close, expand and composer are all visible and not under the top bar', async ({ page, signIn, hr }, info) => {
    noBackendOnly();
    test.skip(info.project.name !== 'phone-390', 'Phone only.');
    await enter(page, signIn, hr);
    await openPanel(page);
    const vp = page.viewportSize()!;
    const fits = async (l: Locator, what: string) => {
      await expect(l, what).toBeVisible();
      const b = (await l.boundingBox())!;
      expect(b.x, `${what} inside on the left`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${what} inside on the right`).toBeLessThanOrEqual(vp.width + 0.5);
      expect(b.y, `${what} inside at the top`).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, `${what} above the bottom edge`).toBeLessThanOrEqual(vp.height + 0.5);
    };
    await fits(panel(page).getByRole('heading', { name: W.panel, exact: true }), 'the heading');
    await fits(panel(page).getByRole('button', { name: 'Close Batsi' }), 'Close');
    await fits(panel(page).getByRole('button', { name: W.expand, exact: true }), 'Expand');
    await fits(composer(page), 'the composer');
    await fits(sendButton(page), 'Send');
    const sheet = (await panel(page).boundingBox())!;
    expect(sheet.width, 'it fills the width').toBeGreaterThanOrEqual(vp.width - 40);
    const noSideScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(noSideScroll, 'no sideways scroll').toBe(true);
  });

  test('AC-12 The full page fits a phone: heading, Back to Today, answer, proposal buttons and composer', async ({ page, signIn, hr, chat, docs }, info) => {
    noBackendOnly();
    test.skip(info.project.name !== 'phone-390', 'Phone only.');
    await expandFromPerson({ chat: chat!, docs: docs!, page, signIn, hr });
    await expect(page).toHaveURL(new RegExp(`${esc(FULL_PAGE)}$`));
    const vp = page.viewportSize()!;
    const back = page.getByRole('link', { name: W.back, exact: true });
    if (!(await back.isVisible())) {
      // On a phone the way back may sit behind the menu, like the other pages' navigation.
      await page.getByRole('button', { name: /menu/i }).first().click();
    }
    await expect(back).toBeVisible();
    await expect(composer(page)).toBeVisible();
    const c = (await composer(page).boundingBox())!;
    expect(c.y + c.height, 'the composer is above the bottom edge').toBeLessThanOrEqual(vp.height + 0.5);
    for (const name of ['Approve', 'Edit', 'Decline']) {
      const b = log(page).getByRole('button', { name, exact: true });
      await b.scrollIntoViewIfNeeded();
      await expect(b, name).toBeVisible();
      const box = (await b.boundingBox())!;
      expect(box.x + box.width, `${name} inside`).toBeLessThanOrEqual(vp.width + 0.5);
    }
    const top = await topBar(page).boundingBox();
    const heading = page.getByRole('heading').first();
    if (top && (await heading.isVisible())) {
      expect((await heading.boundingBox())!.y, `the first heading is not under the top bar (bar ${top.y}+${top.height})`).toBeGreaterThanOrEqual(top.y + top.height - 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll').toBe(true);
  });
});

// ================================================================ AC-13, AC-14

test.describe('AC-13 and AC-14 When it cannot answer', () => {
  test('AC-13 The hourly limit shows the minutes left', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await openPanel(page);
    chat!.mode = 'limit';
    chat!.retryAfter = 12 * 60;
    await ask(page, 'One more question');
    await expect(log(page).getByText(W.limit(12), { exact: true })).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/429|Rate limit|retryAfter/);
  });

  test('AC-14 A failed answer shows the error words and Try again, which asks the same question again', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await openPanel(page);
    chat!.mode = 'failed';
    await ask(page, 'Who is on leave this week?');
    await expect(log(page).getByText(W.error, { exact: true })).toBeVisible();
    expect(await page.locator('body').innerText(), 'no raw error').not.toMatch(/upstream|model unavailable|502|AI service error/);
    chat!.mode = 'ok';
    chat!.reply = () => ({ message: 'Nobody is on leave.' });
    await log(page).getByRole('button', { name: W.retry, exact: true }).click();
    await expect(log(page).getByText('Nobody is on leave.')).toBeVisible();
    const asked = chat!.chats().map((c) => c.body.message);
    expect(asked, 'the same question twice').toEqual(['Who is on leave this week?', 'Who is on leave this week?']);
  });

  test('AC-14 Offline shows the notice and stops the composer; coming back online lets the person ask again', async ({ page, signIn, hr, chat, context }) => {
    noBackendOnly();
    await enter(page, signIn, hr);
    await openPanel(page);
    await context.setOffline(true);
    await expect(panel(page).getByText(W.offline, { exact: true })).toBeVisible();
    await expect(composer(page), 'the composer is off').toBeDisabled();
    expect(chat!.chats()).toHaveLength(0);
    await context.setOffline(false);
    await expect(panel(page).getByText(W.offline, { exact: true })).toBeHidden();
    await expect(composer(page)).toBeEnabled();
  });
});

// ================================================================ AC-17, AC-18

test.describe('AC-17 No paid AI in a test run', () => {
  test('AC-17 A whole conversation reaches no AI host: every Agent API call is the fake’s, and Bedrock, Textract and model hosts see nothing', async ({ page, signIn, hr, chat, docs }) => {
    noBackendOnly();
    const seen: string[] = [];
    page.on('request', (r) => seen.push(r.url()));
    await onPerson({ chat: chat!, docs: docs!, page, signIn, hr });
    await openPanel(page);
    chat!.reply = () => readyReply(PROPOSAL);
    await ask(page, W.s1('Kagiso'));
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText(W.approvedBy('Jane Smith'), { exact: false })).toBeVisible();
    const ai = seen.filter((u) => /bedrock|textract|anthropic\.com|openai\.com|generativelanguage|api\.cohere|mistral\.ai/i.test(u));
    expect(ai, 'no request to an AI host').toEqual([]);
    const agent = seen.filter((u) => /\/agent\/v1\//.test(u) && !/OPTIONS/.test(u));
    expect(agent.length, 'the chat did use the Agent API').toBeGreaterThan(0);
    expect(chat!.calls.length, 'and every one was answered by the fake').toBeGreaterThanOrEqual(chat!.chats().length + chat!.decisions('approve').length);
  });

  test('AC-17 The app holds no AI SDK, no model id and no agent key: the chat only talks to the Agent API with the person’s sign-in', async ({}, info) => {
    desktopOnly(info.project.name);
    const { readdirSync, statSync } = await import('node:fs');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(ts|html|json)$/.test(n) && !/\.spec\.ts$/.test(n)) files.push(f);
      }
    };
    walk(join(__dirname, '..', '..', 'src'));
    const bad = /@aws-sdk\/client-bedrock|@anthropic-ai|bedrock-runtime|x-api-key|claude-[a-z0-9-]+\b|anthropic\./i;
    const hits = files.filter((f) => bad.test(readFileSync(f, 'utf8')));
    expect(hits, 'no file in the app names an AI service, model or key').toEqual([]);
  });

  test('AC-1 No file path or class name in the signed-in app contains "batsi" (the dev server puts component paths in URLs, and ONB-12, 13, 15 forbid a URL naming Batsi)', async ({}, info) => {
    desktopOnly(info.project.name);
    const { readdirSync, statSync } = await import('node:fs');
    const src = join(__dirname, '..', '..', 'src', 'app');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const f = join(d, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(ts|html|css)$/.test(n) && !/\.spec\.ts$/.test(n)) files.push(f);
      }
    };
    walk(src);
    // The public landing page (ds/site) may name Batsi: it is not part of the signed-in shell.
    const shell = files.filter((f) => !/[\\/]ds[\\/]site[\\/]/.test(f) && !/[\\/]features[\\/]public[\\/]/.test(f) && !/[\\/]dev[\\/]/.test(f));
    const badPaths = shell.filter((f) => /batsi/i.test(f.slice(src.length)));
    expect(badPaths, 'no file or folder name contains "batsi" (use e.g. features/hr-assistant/assistant-panel.ts)').toEqual([]);
    const badClass = shell.filter((f) => /\.ts$/.test(f) && /\bclass\s+\w*batsi\w*/i.test(readFileSync(f, 'utf8')));
    expect(badClass, 'no class name contains "batsi" (use e.g. HrChat)').toEqual([]);
  });
});

test.describe('AC-18 Reduce motion', () => {
  test('AC-18 With Reduce motion on the panel works, and the working line keeps playing', async ({ browser, baseURL, hr }, info) => {
    noBackendOnly();
    const ctx = await browser.newContext({ baseURL, viewport: info.project.use.viewport!, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const fake = new ChatFake(new URL(baseURL!).origin);
    await fake.install(ctx);
    const { CognitoFake } = await import('./support/cognito-fake');
    const cognito = new CognitoFake(Object.values(FAKE));
    await cognito.install(ctx);
    const empl = new EmployeesFake(new URL(baseURL!).origin);
    await empl.install(ctx);
    try {
      const { SignInPage } = await import('./support/fixtures');
      const si = new SignInPage(page);
      await enter(page, si, hr);
      await openPanel(page);
      fake.mode = 'hold';
      fake.reply = () => ({ message: 'Nothing to report.' });
      await ask(page, 'Is anyone away today?');
      const working = log(page).getByRole('status');
      await expect(working).toBeVisible();
      const playing = await working.evaluate((el) => {
        const spinner = el.querySelector('.pp-spinner') as HTMLElement | null;
        if (!spinner) return false;
        const s = getComputedStyle(spinner);
        return s.animationName !== 'none' && s.animationPlayState === 'running';
      });
      expect(playing, 'the working indicator still animates').toBe(true);
      fake.release();
      await expect(log(page).getByText('Nothing to report.')).toBeVisible();
      await expect(panel(page)).toBeVisible();
      await expect(composer(page)).toBeEnabled();
    } finally {
      await ctx.close();
    }
  });
});

void forgetSignIn;
void readFileSync;
