import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { HELP_NEW_EMPLOYEES } from '../fixtures/help-company';
import { EmployeesFake, apiPerson, type ApiPerson } from './support/employees-fake';
import { HR_HOME, ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { stripComments } from './support/infra-harness';
import { VERSION } from './support/onb-05/notice';
import { DOC_TYPES, listOf, type DocState, type DocType, type ListAnswer, type MyDocumentsFake } from './support/onb-06/documents-fake';
import { LINDIWE, LINDIWE_ID, NOTICE_MODULE, T0, consentRow, docRow, exportsOf, list as listMyDocuments, storedEmployee, world as docsWorld } from './support/onb-06/lambda-harness';
import { DAYS_BEFORE_START, addDays, chipFor, dateText, dueFor, isOverdue, johannesburgDay } from './support/onb-10/dates';
import { DEADLINE_LINE, chipWords, dueLine, overdueCount } from './support/onb-10/words';
import { REPO, UNDEFINED, runDueDate } from './support/onb-10/due-date-run';
import { rolePairsOf } from './support/onb-10/iam';
import { EMP, MAIL, START, ask, bodyOf, describeRun, itemsById, seeded, withStarts } from './support/onb-10/world';
import { forgetSignIn } from './support/sign-in-again';

/**
 * ONB-10 · Due dates and Overdue (Jira NH-179, epic NH-150). Amber.
 * One test per acceptance criterion (some criteria have several tests), written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-10.md (18 Nov 2026). Notes: ./cards/onb-10.md.
 *
 * Screens: the no-backend run answers GET /v1/me (support/onb-05/me-fake.ts, now carrying `documentsDue` when a test
 * gives it), GET /v1/me/documents (support/onb-06/documents-fake.ts) and GET /v1/employees
 * (support/employees-fake.ts, now carrying `documents_due` when a test gives it) in the browser. Screen tests run at 1280
 * and 390 wide with "today" fixed with page.clock, so "Overdue by 2 days" means the same whenever they run. Lambdas: the
 * real lambda/getEmployees and lambda/getMyStart run against TEN-02's two-company fake AWS, once, at 1280.
 * AC-6 runs at 390 only. AC-8 runs on pepla-dev only. Nothing here calls an AI service. Locked once accepted: ./README.md.
 *
 * The words are in support/onb-10/words.ts (W-1 to W-4 are proposed, not approved: one file to change).
 */

const HERE = __dirname;
const WEB = join(HERE, '..', '..');

// ---------------------------------------------------------------- today, fixed

/** 17 Nov 2026, 11:00 in South Africa. The screen tests run with the page's clock stopped here. */
const NOW = '2026-11-17T09:00:00.000Z';
const TODAY = '2026-11-17';
const ACCEPTED_AT = '2026-11-16T06:42:00.000Z';
const START_PATH = /\/start$/;

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: AC-8 is the pepla-dev check.');
const onceOnly = (testInfo: TestInfo) => {
  test.skip(ON_DEV, 'Reads files and runs Lambdas: no-backend run only.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Reads files and runs Lambdas, not the screen: runs once, at one width.');
};
const phoneOnly = (testInfo: TestInfo) => test.skip(testInfo.project.name !== 'phone-390', 'The phone criterion runs at 390 wide only.');

type Fixtures = { api: EmployeesFake | null };
const test = base.extend<Fixtures>({
  // Installed before the first page load. pepla-dev answers for itself.
  api: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new EmployeesFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
});

// ---------------------------------------------------------------- the employee's Today page, found by its words

const NAMES: Record<DocType, string> = {
  NATIONAL_ID: 'National ID',
  BANK_CONFIRMATION: 'Bank account confirmation letter',
  MATRIC_CERTIFICATE: 'Matric certificate',
  TERTIARY_QUALIFICATION: 'Tertiary qualifications',
};
const HEADING = 'Upload your documents';
const STATE_WORD: Record<DocState, string> = { NOT_UPLOADED: 'Not uploaded yet', WITH_HR: 'With HR', SENT_BACK: 'Needs a new copy', ACCEPTED: 'Accepted' };
const REQUIRED_TYPES = ['NATIONAL_ID', 'BANK_CONFIRMATION'] as const;
const OPTIONAL_TYPES = ['MATRIC_CERTIFICATE', 'TERTIARY_QUALIFICATION'] as const;

const welcome = (page: Page, name: string) => page.getByRole('heading', { name: `Welcome, ${name}`, exact: true });
const checklistHeading = (page: Page) => page.getByRole('heading', { name: HEADING, exact: true });
const row = (page: Page, type: DocType) => page.getByRole('listitem').filter({ has: page.getByText(NAMES[type], { exact: true }) });

type Fx = { page: Page; signIn: SignInPage; employee: Login; me: import('./support/onb-05/me-fake').MeFake | null; myDocuments: MyDocumentsFake | null };

/**
 * Signs the employee in, having accepted the current notice, with today fixed, and lands on Today with the checklist.
 * `documentsDue` is what GET /v1/me answers (none when undefined).
 */
async function openToday(fx: Fx, o: { answer: ListAnswer; documentsDue?: string; now?: string }): Promise<void> {
  const { page, signIn, employee, me, myDocuments } = fx;
  await page.clock.setFixedTime(o.now ?? NOW);
  me!.people.set(employee.email, {
    ...me!.defaultPerson(employee.givenName),
    consents: { [VERSION]: ACCEPTED_AT },
    ...(o.documentsDue ? { documentsDue: o.documentsDue } : {}),
  });
  myDocuments!.answer = o.answer;
  await signIn.open();
  await signIn.signInAs(employee);
  await expect(page).toHaveURL(START_PATH, { timeout: 20_000 });
  await expect(welcome(page, employee.givenName)).toBeVisible();
  await expect(checklistHeading(page)).toBeVisible();
}

/** Changes the date GET /v1/me answers (or removes it) and loads Today again. */
async function reloadWith(fx: Fx, documentsDue: string | undefined): Promise<void> {
  const who = fx.me!.person(fx.employee.email)!;
  if (documentsDue) who.documentsDue = documentsDue;
  else delete who.documentsDue;
  await fx.page.reload();
  await expect(checklistHeading(fx.page)).toBeVisible();
}

type ChipInfo = { tag: string; text: string; datetime: string | null; title: string | null; classes: string; svg: string };
/** Every <time datetime> inside `scope`: the deadline chips. */
async function chipsIn(scope: Locator): Promise<ChipInfo[]> {
  return scope.locator('time[datetime]').evaluateAll((els) =>
    els.map((el) => ({
      tag: el.tagName,
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      datetime: el.getAttribute('datetime'),
      title: el.getAttribute('title'),
      classes: el.className,
      svg: el.querySelector('svg')?.innerHTML ?? '',
    })),
  );
}

/** The lines of a box's text that speak of a deadline: they start with "Due" or "Overdue". */
async function deadlineLines(scope: Locator): Promise<string[]> {
  const text = await scope.innerText();
  return text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => /^(Due|Overdue)\b/.test(l));
}

const tone = (c: ChipInfo): 'danger' | 'warning' | 'none' => (/\bpp-lozenge--danger\b/.test(c.classes) ? 'danger' : /\bpp-lozenge--warning\b/.test(c.classes) ? 'warning' : 'none');
const TONE = { later: 'none', soon: 'warning', today: 'warning', overdue: 'danger' } as const;

/** A required row still to give shows its chip and its date line, and nothing else about a deadline. */
async function expectChipOn(page: Page, type: DocType, due: string, today = TODAY): Promise<ChipInfo> {
  const want = chipFor(due, today);
  const r = row(page, type);
  const chips = await chipsIn(r);
  expect(chips, `${NAMES[type]} (due ${due}, today ${today}): exactly one deadline chip`).toHaveLength(1);
  const c = chips[0]!;
  expect(c.text, `${NAMES[type]}: the chip's words`).toBe(want.words);
  expect(c.datetime, `${NAMES[type]}: <time datetime> is the due date`).toBe(due);
  expect(c.title ?? '', `${NAMES[type]}: the title holds the full date`).toContain(want.dateText);
  expect(c.classes, `${NAMES[type]}: it is the design system's deadline chip`).toMatch(/\bpp-deadline\b/);
  expect(tone(c), `${NAMES[type]}: the ${want.state} colour (the words carry the meaning too)`).toBe(TONE[want.state]);
  expect(c.svg, `${NAMES[type]}: the chip has its icon`).not.toBe('');
  expect(await deadlineLines(r), `${NAMES[type]}: the chip's words and the date line, nothing else about a deadline`).toEqual(
    expect.arrayContaining([want.words, dueLine(want.dateText)]),
  );
  expect((await deadlineLines(r)).length, `${NAMES[type]}: no other deadline line`).toBe(2);
  await expect(r.getByText(dueLine(want.dateText), { exact: true }), `${NAMES[type]}: the date line is "${dueLine(want.dateText)}"`).toBeVisible();
  return c;
}

async function expectNoChip(page: Page, type: DocType, why: string): Promise<void> {
  const r = row(page, type);
  expect(await chipsIn(r), `${NAMES[type]}: no chip ${why}`).toEqual([]);
  expect(await deadlineLines(r), `${NAMES[type]}: no deadline line ${why}`).toEqual([]);
}

// ---------------------------------------------------------------- HR home, found by its words

const SEARCH = 'Search by name or email';
const STEP_WORD: Record<string, string> = { INVITED: 'Invited', DOCUMENTS: 'Documents', IN_REVIEW: 'In review', VERIFIED: 'Verified' };
const STEPS = ['Invited', 'Documents', 'In review', 'Verified'] as const;

const table = (page: Page) => page.getByRole('table', { name: 'New employees', exact: true });
const personRows = (page: Page) => table(page).locator('tbody tr').filter({ has: page.locator('a[href*="/hr/employees/"]') });
const stat = (page: Page, label: string) =>
  page.locator('.pp-stat').filter({ has: page.locator('.pp-stat__label').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }) });
const statValue = (page: Page, label: string) => stat(page, label).locator('.pp-stat__value');
const attentionLines = (page: Page) => page.locator('.pp-stat__meta--attention');

type HomeRow = { name: string; step: string; note: string[]; chips: ChipInfo[]; start: string };
async function readHome(page: Page): Promise<HomeRow[]> {
  const rows = personRows(page);
  const n = await rows.count();
  const out: HomeRow[] = [];
  for (let i = 0; i < n; i++) {
    const tr = rows.nth(i);
    const cell = tr.locator('td').nth(1);
    const lines = (await cell.innerText()).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    out.push({
      name: (await tr.locator('a[href*="/hr/employees/"]').innerText()).replace(/\s+/g, ' ').trim(),
      step: lines[0] ?? '',
      note: lines.slice(1),
      chips: await chipsIn(cell),
      start: (await tr.locator('td').nth(2).innerText()).replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

async function openHome(page: Page, signIn: SignInPage, hr: Login, now: string | null = NOW): Promise<void> {
  if (now) await page.clock.setFixedTime(now);
  await signIn.open();
  await signIn.signInAs(hr);
  await expect(page).toHaveURL(HR_HOME);
}

// ---------------------------------------------------------------- HR home's made-up people (17 Nov 2026 is today)

type Made = { first: string; last: string; step: ApiPerson['step']; stage: string; due: string; overdueBy: number };
const WHO: Made[] = [
  { first: 'Ayanda', last: 'Cele', step: 'DOCUMENTS', stage: 'ACTIVE', due: '2026-11-15', overdueBy: 2 },
  { first: 'Busi', last: 'Dube', step: 'DOCUMENTS', stage: 'ACTIVE', due: '2026-11-16', overdueBy: 1 },
  { first: 'Chipo', last: 'Ellis', step: 'INVITED', stage: 'INVITED', due: '2026-11-10', overdueBy: 7 },
  { first: 'Dumi', last: 'Fosi', step: 'DOCUMENTS', stage: 'ACTIVE', due: '2026-11-17', overdueBy: 0 }, // due today: not late yet
  { first: 'Eli', last: 'Gola', step: 'DOCUMENTS', stage: 'ACTIVE', due: '2026-11-18', overdueBy: 0 }, // due tomorrow
  { first: 'Fez', last: 'Hadebe', step: 'INVITED', stage: 'INVITED', due: '2026-12-24', overdueBy: 0 }, // due later
  { first: 'Gugu', last: 'Ibrahim', step: 'IN_REVIEW', stage: 'DOCUMENTS_SUBMITTED', due: '2026-10-01', overdueBy: 0 }, // HR's turn
  { first: 'Hlengi', last: 'Jele', step: 'VERIFIED', stage: 'VERIFIED', due: '2026-10-02', overdueBy: 0 },
  { first: 'Iman', last: 'Khan', step: null, stage: '', due: '2026-10-03', overdueBy: 0 }, // no step
  { first: 'Jabu', last: 'Lekota', step: 'DOCUMENTS', stage: 'ACTIVE', due: '', overdueBy: 0 }, // no due date
  { first: 'Kea', last: 'Molefe', step: 'INVITED', stage: 'INVITED', due: '2026-11-09', overdueBy: 8 },
];
const nameOf = (m: { first: string; last: string }) => `${m.first} ${m.last}`;
const personOf = (m: Made): ApiPerson =>
  apiPerson({
    first_name: m.first,
    last_name: m.last,
    stage: m.stage,
    step: m.step,
    planned_start_date: m.due ? addDays(m.due, DAYS_BEFORE_START) : '',
    documents_due: m.due,
  });
const stepWordOf = (m: Made) => (m.step ? STEP_WORD[m.step]! : 'Not set');
/** Page 1 holds nobody late, so a count taken from page 1 alone says nothing. 4 + 4 + 3 people. */
const PAGED_ORDER = [3, 4, 5, 6, 0, 1, 7, 8, 2, 9, 10].map((i) => WHO[i]!);
const overdueIn = (people: Made[]) => people.filter((m) => isOverdue(m.step, m.due, TODAY));

// ---------------------------------------------------------------- the phone: nothing hidden, nothing wide

async function hiddenOrCovered(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    const bar = document.querySelector('.pp-top-navigation, [role="banner"]');
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const els = [...document.querySelectorAll('main :is(h1,h2,h3,h4,h5,h6,[role="heading"],a[href],button,.pp-lozenge,time[datetime],.pp-stat,.pp-stat__meta--attention)')].filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null;
    });
    const name = (el: Element) => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${(el as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
    window.scrollTo(0, 0);
    document.querySelector('main')?.scrollTo?.(0, 0);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.top < barBottom - 1) out.push(`${name(el)} starts under the top bar (${Math.round(r.top)} < ${Math.round(barBottom)})`);
      if (r.left < -1 || r.right > window.innerWidth + 1) out.push(`${name(el)} is outside the screen's width`);
    }
    for (const el of els) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2)), r.top + r.height / 2);
      if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) out.push(`${name(el)} is covered by ${hit ? hit.tagName.toLowerCase() + '.' + hit.className : 'nothing'}`);
    }
    window.scrollTo(0, 0);
    return out;
  });
}

/** Nothing is cut short: every chip and every date line shows all its words, inside the screen. */
async function wordsFullyShown(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const target = [...document.querySelectorAll('main time[datetime], main .pp-stat__meta--attention, main .pp-lozenge__text')] as HTMLElement[];
    for (const el of target) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.left < -1 || r.right > window.innerWidth + 1) out.push(`"${el.innerText.trim()}" is outside the screen's width`);
      const s = getComputedStyle(el);
      const clips = s.overflowX !== 'visible' || s.textOverflow === 'ellipsis';
      if (clips && el.scrollWidth > el.clientWidth + 1) out.push(`"${el.innerText.trim()}" is cut short (${el.scrollWidth} > ${el.clientWidth})`);
      const box = el.closest('.pp-stat, .pp-card, td, li') as HTMLElement | null;
      if (box && r.right > box.getBoundingClientRect().right + 1) out.push(`"${el.innerText.trim()}" runs past its box`);
    }
    for (const el of document.querySelectorAll('main *')) {
      if (el.tagName === 'BODY') continue;
      const r = el.getBoundingClientRect();
      if (r.width > window.innerWidth + 1) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} is wider than the screen (${Math.round(r.width)})`);
    }
    return out;
  });
}

async function sidewaysScroll(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    for (const el of document.querySelectorAll('main *')) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()}.${el.className} ${el.scrollWidth} > ${el.clientWidth}`);
    }
    return out;
  });
}

async function seriousAxe(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help} :: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

// ---------------------------------------------------------------- tests

test.describe('ONB-10 Due dates and Overdue', () => {
  // ================================================================ AC-1 the rule, in one place

  test('AC-1 The rule is one module: 7 days before the start date, calendar days, never a throw', async ({}, testInfo) => {
    onceOnly(testInfo);
    expect(existsSync(join(REPO, 'lambda', 'shared', 'due-date.mjs')), 'lambda/shared/due-date.mjs exists').toBe(true);

    const examples: Array<[string, string]> = [
      ['2026-12-01', '2026-11-24'],
      ['2026-03-03', '2026-02-24'], // a month change; 2026 is not a leap year
      ['2028-03-05', '2028-02-27'], // a leap year
      ['2027-01-04', '2026-12-28'], // a year change
      ['2026-01-05', '2025-12-29'], // the other way over a new year
      ['2100-03-05', '2100-02-26'], // 2100 is not a leap year
      ['2026-11-07', '2026-10-31'], // exactly the 7 days, nothing else
    ];
    const bad: unknown[] = ['', undefined, null, '2026-12-1', '2026-1-01', '2026/12/01', '01-12-2026', '1 Dec 2026', '2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-12-00', '2026-12-32', 'abc', 20261201, {}, [], '2026-12-01T10:00:00Z', '2026-12-01 '];
    const calls = [
      ...examples.map(([start]) => ({ fn: 'documentsDueDate' as const, args: [start] })),
      ...examples.map(([start]) => ({ fn: 'documentsDueDate' as const, args: [start, 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa'] })),
      ...bad.map((v) => ({ fn: 'documentsDueDate' as const, args: [v === undefined ? UNDEFINED : v] })),
      { fn: 'documentsDueDate' as const, args: [] },
      ...[UNDEFINED, null, '', 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'ten_bbbbbbbbbbbbbbbbbbbbbbbbbb', 'not a company', 42, {}].map((c) => ({ fn: 'dueDaysFor' as const, args: [c] })),
      { fn: 'dueDaysFor' as const, args: [] },
    ];
    const run = runDueDate(calls);
    expect(run.importError, 'the module loads').toBeUndefined();
    expect(run.exports['DOCUMENTS_DUE_DAYS_BEFORE_START'], 'DOCUMENTS_DUE_DAYS_BEFORE_START is 7').toBe(7);
    expect(run.exports['documentsDueDate'], 'documentsDueDate is exported').toBe('function');
    expect(run.exports['dueDaysFor'], 'dueDaysFor is exported').toBe('function');

    let i = 0;
    for (const [start, due] of examples) {
      const r = run.results[i++]!;
      expect(r.threw, `${start} did not throw`).toBeUndefined();
      expect(r.value, `${start} is due ${due}`).toBe(due);
    }
    for (const [start, due] of examples) {
      const r = run.results[i++]!;
      expect(r.value, `${start} for a company: still ${due} (the rule ignores the company today)`).toBe(due);
    }
    for (const v of bad) {
      const r = run.results[i++]!;
      expect(r.threw, `${JSON.stringify(v)} does not throw`).toBeUndefined();
      expect(r.value, `${JSON.stringify(v)} has no due date: null`).toBeNull();
    }
    const none = run.results[i++]!;
    expect(none.threw, 'no argument does not throw').toBeUndefined();
    expect(none.value, 'no argument: null').toBeNull();
    for (const c of [UNDEFINED, null, '', 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa', 'ten_bbbbbbbbbbbbbbbbbbbbbbbbbb', 'not a company', 42, {}]) {
      const r = run.results[i++]!;
      expect(r.value, `dueDaysFor(${JSON.stringify(c)}): 7, whatever the company`).toBe(7);
    }
    expect(run.results[i++]!.value, 'dueDaysFor(): 7').toBe(7);

    // The test's own calendar agrees with the examples (so a wrong example here would show).
    for (const [start, due] of examples) expect(dueFor(start), `the tests' own maths: ${start}`).toBe(due);
  });

  test('AC-1 getEmployees answers documents_due on every person and getMyStart answers documentsDue, the same date for the same row', async ({}, testInfo) => {
    onceOnly(testInfo);
    test.setTimeout(3 * 60_000);

    // HR of company A: every person carries documents_due ("" when there is no start date).
    const hrA = ask('getEmployees', 'hrA', {}, { tables: seeded() });
    expect(hrA.response?.statusCode, `HR of A lists (${describeRun(hrA)})`).toBe(200);
    const listA = itemsById(hrA);
    expect(Object.keys(listA).sort(), 'HR of A lists A\'s people and the legacy person (the legacy rule is on)').toEqual([EMP.a1, EMP.a2, EMP.legacy].sort());
    for (const [id, item] of Object.entries(listA)) expect(typeof item['documents_due'], `${id}: documents_due is on the person, as text`).toBe('string');
    expect(listA[EMP.a1]!['documents_due'], 'a person starting 1 Dec 2026').toBe(dueFor(START.a1));
    expect(listA[EMP.a1]!['documents_due']).toBe('2026-11-24');
    expect(listA[EMP.legacy]!['documents_due'], 'a year change').toBe('2026-12-28');
    expect(listA[EMP.a2]!['documents_due'], 'no start date: an empty text, as planned_start_date').toBe('');
    expect(listA[EMP.a2]!['planned_start_date'], 'and planned_start_date is as it was').toBe('');
    expect(listA[EMP.a1]!['planned_start_date'], 'planned_start_date is as it was').toBe(START.a1);
    expect(listA[EMP.a1]!['step'], 'the step is as it was').toBe('DOCUMENTS');
    expect(Object.keys(listA[EMP.a1]!).filter((k) => /encrypted/i.test(k)), 'nothing private was added').toEqual([]);
    expect(Object.keys(listA[EMP.a1]!).filter((k) => /due/i.test(k)), 'one new field: documents_due').toEqual(['documents_due']);

    // HR of company B: only B's person, with B's own date, never A's.
    const hrB = ask('getEmployees', 'hrB', {}, { tables: seeded() });
    expect(hrB.response?.statusCode, `HR of B lists (${describeRun(hrB)})`).toBe(200);
    expect(Object.keys(itemsById(hrB)), 'HR of B lists B\'s person only').toEqual([EMP.b1]);
    expect(itemsById(hrB)[EMP.b1]!['documents_due'], 'B\'s person: a month change').toBe('2026-02-24');
    for (const a of ['2026-11-24', '2026-12-28']) expect(JSON.stringify(bodyOf(hrB)), `HR of B never gets A's date ${a}`).not.toContain(a);
    expect(JSON.stringify(bodyOf(hrA)), 'HR of A never gets B\'s date').not.toContain('2026-02-24');

    // The agent key reads the same list: it carries the field too.
    const agent = ask('getEmployees', 'agentA', {}, { tables: seeded() });
    expect(agent.response?.statusCode, 'the agent lists').toBe(200);
    expect(itemsById(agent)[EMP.a1]?.['documents_due'], 'the agent sees the same date').toBe('2026-11-24');

    // The new employee: documentsDue with the same date for the same row; absent when there is no date.
    const meA = ask('getMyStart', 'empA', {}, { tables: seeded() });
    expect(meA.response?.statusCode, `GET /v1/me as A's employee (${describeRun(meA)})`).toBe(200);
    const a = bodyOf(meA) as Record<string, unknown>;
    expect(a['startDate'], 'startDate is as it was').toBe(START.a1);
    expect(a['documentsDue'], 'documentsDue is the date HR sees for the same row').toBe(listA[EMP.a1]!['documents_due']);
    expect(Object.keys(a).sort(), 'one new field, nothing else changed').toEqual(['company', 'consent', 'department', 'documentsDue', 'firstName', 'notice', 'startDate'].sort());
    const meB = ask('getMyStart', 'empB', {}, { tables: seeded() });
    expect((bodyOf(meB) as Record<string, unknown>)['documentsDue'], 'B\'s employee gets B\'s date').toBe('2026-02-24');
    expect(JSON.stringify(bodyOf(meB)), 'and never A\'s').not.toContain('2026-11-24');

    const noDate = ask('getMyStart', 'empA', {}, { tables: withStarts({ [EMP.a1]: '' }) });
    expect(noDate.response?.statusCode, 'a person with no start date still gets the page').toBe(200);
    const none = bodyOf(noDate) as Record<string, unknown>;
    expect('documentsDue' in none, 'no start date: documentsDue is left out, as startDate is').toBe(false);
    expect('startDate' in none, 'and startDate is left out').toBe(false);

    // A date that is not a date gives no due date and no error.
    for (const odd of ['2026-02-30', 'soon', '1 Dec 2026']) {
      const run = ask('getMyStart', 'empA', {}, { tables: withStarts({ [EMP.a1]: odd }) });
      expect(run.response?.statusCode, `start date "${odd}": GET /v1/me answers, no 500 (${describeRun(run)})`).toBe(200);
      expect('documentsDue' in (bodyOf(run) as object), `start date "${odd}": no documentsDue`).toBe(false);
      const list = ask('getEmployees', 'hrA', {}, { tables: withStarts({ [EMP.a1]: odd }) });
      expect(list.response?.statusCode, `start date "${odd}": GET /v1/employees answers`).toBe(200);
      expect(itemsById(list)[EMP.a1]!['documents_due'], `start date "${odd}": documents_due is ""`).toBe('');
    }

    // Nothing the caller sends changes the answer: the date comes only from the stored row.
    const trick = { employee_id: EMP.b1, email: MAIL.b1, startDate: '2030-01-01', documentsDue: '2030-01-01', documents_due: '2030-01-01', planned_start_date: '2030-01-01' };
    const withQuery = ask('getMyStart', 'empA', { query: trick }, { tables: seeded() });
    const withBody = ask('getMyStart', 'empA', { method: 'GET', body: trick }, { tables: seeded() });
    expect(bodyOf(withQuery), 'GET /v1/me: a query with another person, another date: the same answer').toEqual(bodyOf(meA));
    expect(bodyOf(withBody), 'GET /v1/me: a body with another person, another date: the same answer').toEqual(bodyOf(meA));
    const listWithQuery = ask('getEmployees', 'hrA', { query: trick }, { tables: seeded() });
    expect(itemsById(listWithQuery)[EMP.a1]!['documents_due'], 'GET /v1/employees: a query changes no date').toBe('2026-11-24');
    expect(JSON.stringify(bodyOf(listWithQuery)), 'and no date of 2030').not.toContain('2030');
    expect(Object.keys(itemsById(listWithQuery)).sort(), 'and no other person').toEqual(Object.keys(listA).sort());
  });

  // ================================================================ AC-2 the checklist shows each due date

  test('AC-2 The checklist shows the chip and "Due 24 Nov 2026" on each required document still to give, in every state', async ({ page, signIn, employee, me, myDocuments }, testInfo) => {
    noBackendOnly();
    test.setTimeout(3 * 60_000);
    const fx: Fx = { page, signIn, employee, me, myDocuments };
    const toGive = listOf({ NATIONAL_ID: 'NOT_UPLOADED', BANK_CONFIRMATION: 'SENT_BACK' });
    const cases = [
      { say: 'later: 5 days', due: addDays(TODAY, 5) },
      { say: 'soon: 3 days', due: addDays(TODAY, 3) },
      { say: 'soon: 1 day', due: addDays(TODAY, 1) },
      { say: 'later: 4 days', due: addDays(TODAY, 4) },
      { say: 'today', due: TODAY },
      { say: 'overdue: 1 day', due: addDays(TODAY, -1) },
      { say: 'overdue: 2 days', due: addDays(TODAY, -2) },
      { say: 'overdue: 40 days, over a month end', due: addDays(TODAY, -40) },
      { say: 'a date next year', due: '2027-02-03' },
    ];
    void testInfo;
    await openToday(fx, { answer: toGive, documentsDue: cases[0]!.due });
    const icons: Record<string, string> = {};
    for (const [n, c] of cases.entries()) {
      if (n > 0) await reloadWith(fx, c.due);
      const want = chipFor(c.due, TODAY);
      for (const type of REQUIRED_TYPES) {
        const chip = await expectChipOn(page, type, c.due);
        icons[`${want.state}`] = icons[`${want.state}`] ?? chip.svg;
        expect(chip.svg, `${c.say}: ${NAMES[type]} has the same icon as the other ${want.state} chips`).toBe(icons[`${want.state}`]);
      }
      for (const type of OPTIONAL_TYPES) await expectNoChip(page, type, `on the optional ${NAMES[type]} (${c.say})`);
    }
    // The clock for later, soon and today; the alert clock for overdue: three states share one icon, overdue has its own.
    expect(icons['later'], 'later and soon have the same icon').toBe(icons['soon']);
    expect(icons['today'], 'today has the same icon as soon').toBe(icons['soon']);
    expect(icons['overdue'], 'overdue has an icon of its own').not.toBe(icons['soon']);
    expect(icons['overdue'], 'overdue has an icon').not.toBe('');

    // Only the documents still to give: with HR and accepted show neither, whatever the date.
    await reloadWith(fx, addDays(TODAY, -3));
    fx.myDocuments!.answer = listOf({ NATIONAL_ID: 'WITH_HR', BANK_CONFIRMATION: 'ACCEPTED' });
    await page.reload();
    await expect(checklistHeading(page)).toBeVisible();
    await expect(row(page, 'NATIONAL_ID').getByText(STATE_WORD.WITH_HR, { exact: true })).toBeVisible();
    await expect(row(page, 'BANK_CONFIRMATION').getByText(STATE_WORD.ACCEPTED, { exact: true })).toBeVisible();
    for (const type of DOC_TYPES) await expectNoChip(page, type, 'on a document that is with HR or accepted (or optional)');

    // One required document to give, one with HR: only the one still to give has a chip.
    fx.myDocuments!.answer = listOf({ NATIONAL_ID: 'WITH_HR', BANK_CONFIRMATION: 'NOT_UPLOADED', MATRIC_CERTIFICATE: 'NOT_UPLOADED', TERTIARY_QUALIFICATION: 'SENT_BACK' });
    await page.reload();
    await expect(checklistHeading(page)).toBeVisible();
    await expectNoChip(page, 'NATIONAL_ID', 'on the ID that is with HR');
    await expectChipOn(page, 'BANK_CONFIRMATION', addDays(TODAY, -3));
    await expectNoChip(page, 'MATRIC_CERTIFICATE', 'on an optional document nobody has uploaded');
    await expectNoChip(page, 'TERTIARY_QUALIFICATION', 'on an optional document that was sent back');

    // No due date from the server: no chip and no line, whatever the state.
    fx.myDocuments!.answer = toGive;
    await reloadWith(fx, undefined);
    for (const type of DOC_TYPES) await expectNoChip(page, type, 'when GET /v1/me has no documentsDue');
  });

  test('AC-2 Today makes no call beyond the ones ONB-05 and ONB-06 already lock, and the due date is not on the documents answer', async ({ page, signIn, employee, me, myDocuments, baseURL }) => {
    noBackendOnly();
    const fx: Fx = { page, signIn, employee, me, myDocuments };
    const seen: Array<{ method: string; url: URL }> = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') seen.push({ method: r.method(), url });
    });
    await openToday(fx, { answer: listOf({ NATIONAL_ID: 'NOT_UPLOADED', BANK_CONFIRMATION: 'NOT_UPLOADED' }), documentsDue: addDays(TODAY, 2) });
    await expectChipOn(page, 'NATIONAL_ID', addDays(TODAY, 2));
    await page.waitForLoadState('networkidle');

    const app = new URL(baseURL!).origin;
    const cognito = /^cognito-idp\.[a-z0-9-]+\.amazonaws\.com$/;
    const fonts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
    const outside = seen.filter((s) => s.url.origin !== app && !cognito.test(s.url.hostname) && !fonts.has(s.url.hostname));
    const paths = [...new Set(outside.map((s) => `${s.method} ${s.url.pathname}`))].sort();
    expect(paths.filter((p) => !/^GET \/v1\/company\/modules$/.test(p)), 'only GET /v1/me and GET /v1/me/documents (and the modules call every page makes)').toEqual(['GET /v1/me', 'GET /v1/me/documents']);
    expect(me!.posts(), 'nothing is posted from Today').toEqual([]);
    expect(myDocuments!.calls.filter((c) => c.method !== 'GET' || c.path !== '/v1/me/documents'), 'the documents call is ONB-06\'s, unchanged').toEqual([]);
    for (const c of [...me!.calls, ...myDocuments!.calls]) expect(c.path, 'no route for due dates').not.toMatch(/due|overdue|deadline/i);
  });

  // ================================================================ AC-3 the words, by date

  test('AC-3 The words, by date: deadlineOf gives the state, the words and the date for 12 days ahead to 2 days past', async ({}, testInfo) => {
    onceOnly(testInfo);
    const file = join(WEB, 'src', 'app', 'core', 'deadline.ts');
    expect(existsSync(file), 'pepla-web/src/app/core/deadline.ts exists').toBe(true);
    const source = readFileSync(file, 'utf8');
    // A pure module: it loads without Angular, so this test (and its own unit test) can call it.
    expect(source, 'deadline.ts imports nothing from Angular').not.toMatch(/@angular/);
    expect(source, 'deadline.ts imports nothing from the ds barrel').not.toMatch(/from\s+['"][^'"]*\/ds['"]/);
    const mod = (await import(file)) as { deadlineOf?: (due: string, today: string) => { state: string; days: number; words: string; dateText: string } | null | undefined };
    expect(typeof mod.deadlineOf, 'deadlineOf is exported').toBe('function');
    const of = mod.deadlineOf!;

    // deadlineOf(due, today): `due` and `today` are YYYY-MM-DD; `today` is the Johannesburg calendar date.
    const cases: Array<[string, string, 'later' | 'soon' | 'today' | 'overdue', string, number]> = [
      ['2026-11-29', '2026-11-17', 'later', 'Due in 12 days', 12],
      ['2026-11-21', '2026-11-17', 'later', 'Due in 4 days', 4],
      ['2026-11-20', '2026-11-17', 'soon', 'Due in 3 days', 3],
      ['2026-11-19', '2026-11-17', 'soon', 'Due in 2 days', 2],
      ['2026-11-18', '2026-11-17', 'soon', 'Due in 1 day', 1],
      ['2026-11-17', '2026-11-17', 'today', 'Due today', 0],
      ['2026-11-16', '2026-11-17', 'overdue', 'Overdue by 1 day', 1],
      ['2026-11-15', '2026-11-17', 'overdue', 'Overdue by 2 days', 2],
      ['2026-12-02', '2026-11-28', 'later', 'Due in 4 days', 4], // over a month end
      ['2027-01-02', '2026-12-30', 'soon', 'Due in 3 days', 3], // over a year end
      ['2028-03-01', '2028-02-28', 'soon', 'Due in 2 days', 2], // over a leap day
      ['2026-10-25', '2026-11-17', 'overdue', 'Overdue by 23 days', 23],
      ['2026-03-30', '2026-03-28', 'soon', 'Due in 2 days', 2], // the day clocks change in Europe: still whole calendar days
    ];
    for (const [due, today, state, words, n] of cases) {
      const r = of(due, today);
      expect(r, `${due} on ${today} gives a result`).toBeTruthy();
      expect(r!.state, `${due} on ${today}: state`).toBe(state);
      expect(r!.words, `${due} on ${today}: words`).toBe(words);
      expect(r!.words, `${due} on ${today}: the words are the proposed W-1 words`).toBe(chipFor(due, today).words);
      expect(Math.abs(r!.days), `${due} on ${today}: whole days`).toBe(n);
      expect(r!.dateText, `${due} on ${today}: the date as "24 Nov 2026"`).toBe(dateText(due));
    }
    for (const bad of ['', 'soon', '2026-02-30', '2026-13-01', '24 Nov 2026', '2026-11-1', '2026/11/24', '2026-11-24T10:00:00Z']) {
      expect(of(bad, '2026-11-17') == null, `"${bad}" gives no chip`).toBe(true);
    }
    expect(of(undefined as unknown as string, '2026-11-17') == null, 'no date gives no chip').toBe(true);
  });

  for (const z of [
    { tz: 'Pacific/Auckland', at: '2026-11-10T21:30:00.000Z', sa: '23:30 on 10 Nov', today: '2026-11-10', zone: 'a browser in Auckland, where it is already 11 Nov' },
    { tz: 'America/Los_Angeles', at: '2026-11-10T22:30:00.000Z', sa: '00:30 on 11 Nov', today: '2026-11-11', zone: 'a browser in Los Angeles (and the clock\'s own UTC date), where it is still 10 Nov' },
  ]) {
    test.describe(`South Africa decides the day: ${z.sa}, ${z.tz}`, () => {
      test.use({ timezoneId: z.tz });

      test(`AC-3 At ${z.sa} in South Africa Today counts the day there, not in ${z.zone}`, async ({ page, signIn, employee, me, myDocuments }) => {
        noBackendOnly();
        const fx: Fx = { page, signIn, employee, me, myDocuments };
        const due = '2026-11-10';
        await openToday(fx, { answer: listOf({ NATIONAL_ID: 'NOT_UPLOADED', BANK_CONFIRMATION: 'NOT_UPLOADED' }), documentsDue: due, now: z.at });
        for (const type of REQUIRED_TYPES) await expectChipOn(fx.page, type, due, z.today);
      });

      test(`AC-3 At ${z.sa} in South Africa HR home counts who is overdue by the day there`, async ({ page, signIn, hr, api }) => {
        noBackendOnly();
        // Thabo's documents are due on 10 Nov; Lindani's a day before. Whether Thabo is late depends on the day in South Africa.
        const thabo: Made = { first: 'Thabo', last: 'Zwane', step: 'DOCUMENTS', stage: 'ACTIVE', due: '2026-11-10', overdueBy: 0 };
        const lindani: Made = { first: 'Lindani', last: 'Mbeki', step: 'INVITED', stage: 'INVITED', due: '2026-11-09', overdueBy: 0 };
        api!.people = [thabo, lindani].map(personOf);
        await openHome(page, signIn, hr, z.at);
        await expect(personRows(page)).toHaveCount(2);
        const lateOnes = [thabo, lindani].filter((m) => isOverdue(m.step, m.due, z.today));
        await expect(attentionLines(page), `${overdueCount(lateOnes.length)} on ${z.today} in South Africa`).toHaveText([new RegExp(`^\\s*${overdueCount(lateOnes.length)}\\s*$`)]);
        const rows = await readHome(page);
        for (const m of [thabo, lindani]) {
          const want = isOverdue(m.step, m.due, z.today) ? [chipWords('overdue', chipFor(m.due, z.today).days)] : [];
          expect(rows.find((r) => r.name === nameOf(m))!.note, `${nameOf(m)} (due ${m.due}) on ${z.today} in South Africa`).toEqual(want);
        }
      });
    });
  }

  // ================================================================ AC-4 HR home counts who is overdue

  test('AC-4 HR home counts who is overdue across all pages, and shows nothing when nobody is', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    test.setTimeout(3 * 60_000);
    const late = overdueIn(PAGED_ORDER);
    expect(late.map(nameOf).sort(), 'the made-up people: four are overdue').toEqual(['Ayanda Cele', 'Busi Dube', 'Chipo Ellis', 'Kea Molefe']);

    api!.people = PAGED_ORDER.map(personOf);
    api!.pageSizes = [4, 4, 3]; // page 1 holds nobody late, so a count from page 1 alone would show nothing
    await openHome(page, signIn, hr);
    await expect(personRows(page)).toHaveCount(PAGED_ORDER.length);

    // The Documents stat has the line, with its icon, and no other stat has one.
    const line = stat(page, 'Documents').locator('.pp-stat__meta--attention');
    await expect(line, `"${overdueCount(late.length)}" under the Documents count`).toHaveText(new RegExp(`^\\s*${overdueCount(late.length)}\\s*$`));
    expect(await line.locator('svg').count(), 'the line has its clock icon').toBe(1);
    await expect(attentionLines(page), 'one overdue line on the page').toHaveCount(1);
    for (const label of ['Invited', 'In review', 'Verified']) await expect(stat(page, label).locator('.pp-stat__meta--attention'), `no overdue line under ${label}`).toHaveCount(0);

    // The four counts are as ONB-02 made them (by step, everyone, every page).
    const want = { Invited: 0, Documents: 0, 'In review': 0, Verified: 0 } as Record<string, number>;
    for (const m of PAGED_ORDER) if (m.step) want[STEP_WORD[m.step]!]!++;
    for (const s of STEPS) await expect(statValue(page, s), `count "${s}"`).toHaveText(String(want[s]));

    // Search changes the table, never the count.
    const search = page.getByRole('searchbox', { name: SEARCH, exact: true });
    await search.fill('Gugu');
    await expect(personRows(page)).toHaveCount(1);
    await expect(line, 'a search does not change the overdue count').toHaveText(new RegExp(`^\\s*${overdueCount(late.length)}\\s*$`));
    await search.fill('no-such-person-xyzzy');
    await expect(personRows(page)).toHaveCount(0);
    await expect(line, 'a search with no match does not change it either').toHaveText(new RegExp(`^\\s*${overdueCount(late.length)}\\s*$`));
    await search.fill('');

    // One person overdue: "1 overdue".
    api!.people = [personOf(WHO[0]!), personOf(WHO[3]!), personOf(WHO[6]!)];
    api!.pageSizes = [];
    await page.reload();
    await expect(personRows(page)).toHaveCount(3);
    await expect(attentionLines(page)).toHaveText([new RegExp(`^\\s*${overdueCount(1)}\\s*$`)]);

    // Nobody overdue (due today and later, in review, verified, no step, no date): no line, and not "0 overdue".
    api!.people = [3, 4, 5, 6, 7, 8, 9].map((i) => personOf(WHO[i]!));
    await page.reload();
    await expect(personRows(page)).toHaveCount(7);
    await expect(attentionLines(page), 'nobody overdue: no overdue line at all').toHaveCount(0);
    expect(await page.locator('main').innerText(), 'nobody overdue: the word "overdue" is nowhere on the page').not.toMatch(/overdue/i);
    for (const s of STEPS) await expect(statValue(page, s)).toBeVisible();

    // No people, and a failure to load: no overdue line either.
    api!.people = [];
    await page.reload();
    await expect(page.getByText('No new employees yet.', { exact: true })).toBeVisible();
    await expect(attentionLines(page)).toHaveCount(0);
    api!.mode = 'error';
    await page.reload();
    await expect(page.getByText('New employees could not be loaded.', { exact: true })).toBeVisible();
    await expect(attentionLines(page)).toHaveCount(0);
  });

  test('AC-4 While the people load there is no overdue line, and no count shows a number', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    api!.people = PAGED_ORDER.map(personOf);
    api!.mode = 'hold';
    await openHome(page, signIn, hr);
    await expect.poll(() => api!.gets().length, 'HR home asks for the people').toBeGreaterThan(0);
    await expect(page.locator('.pp-skeleton, [aria-busy="true"]').first(), 'placeholders show while loading').toBeVisible();
    await expect(attentionLines(page), 'no overdue line while loading').toHaveCount(0);
    expect(await page.locator('main').innerText(), 'the word "overdue" is not on the page while loading').not.toMatch(/overdue/i);
    expect((await page.locator('.pp-stat__value').allInnerTexts()).filter((v) => /\d/.test(v)), 'no count shows a number while loading').toEqual([]);
    api!.release();
    await expect(personRows(page)).toHaveCount(PAGED_ORDER.length);
    await expect(attentionLines(page)).toHaveText([new RegExp(`^\\s*${overdueCount(4)}\\s*$`)]);
  });

  // ================================================================ AC-5 "Overdue by 2 days" against the person

  test('AC-5 Each overdue person shows "Overdue by {n} days" under the step word, and nobody else shows a line', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    api!.people = WHO.map(personOf);
    await openHome(page, signIn, hr);
    await expect(personRows(page)).toHaveCount(WHO.length);
    const rows = await readHome(page);

    for (const m of WHO) {
      const r = rows.find((x) => x.name === nameOf(m));
      expect(r, `${nameOf(m)} has a row`).toBeTruthy();
      expect(r!.step, `${nameOf(m)}: the first line of the Step cell is the step word`).toBe(stepWordOf(m));
      if (m.overdueBy > 0) {
        expect(r!.note, `${nameOf(m)} (due ${m.due}, today ${TODAY}): under the step word`).toEqual([chipWords('overdue', m.overdueBy)]);
        expect(r!.chips, `${nameOf(m)}: the line is a deadline chip`).toHaveLength(1);
        expect(r!.chips[0]!.datetime, `${nameOf(m)}: <time datetime> is the due date`).toBe(m.due);
        expect(r!.chips[0]!.title ?? '', `${nameOf(m)}: the title holds the full date`).toContain(dateText(m.due));
        expect(tone(r!.chips[0]!), `${nameOf(m)}: the danger colour, with the words`).toBe('danger');
        expect(r!.chips[0]!.svg, `${nameOf(m)}: with its icon`).not.toBe('');
      } else {
        expect(r!.note, `${nameOf(m)} (${m.due || 'no due date'}, step ${m.step}): no line`).toEqual([]);
        expect(r!.chips, `${nameOf(m)}: no chip`).toEqual([]);
      }
    }
    expect(rows.find((x) => x.name === 'Busi Dube')!.note, 'one day: singular').toEqual(['Overdue by 1 day']);
    expect(rows.find((x) => x.name === 'Ayanda Cele')!.note, 'two days: plural').toEqual(['Overdue by 2 days']);

    // The other columns are as ONB-02 made them.
    for (const r of rows) expect(r.start, `${r.name}: start date`).toMatch(/^(\d{1,2} [A-Z][a-z]{2} \d{4}|Not set)$/);
    const text = await table(page).innerText();
    expect(text.split('\n').filter((l) => /overdue/i.test(l)).length, 'one overdue line per overdue person, nowhere else in the table').toBe(overdueIn(WHO).length);
    expect((await readHome(page)).filter((r) => r.note.length).length).toBe(4);
    // Every line that speaks of a deadline is one of the card's words.
    for (const l of (await table(page).innerText()).split('\n').map((s) => s.trim()).filter((s) => /^(Due|Overdue)\b/.test(s))) expect(l, 'a deadline line is W-4').toMatch(DEADLINE_LINE);
  });

  // ================================================================ AC-6 phone

  test('AC-6 Phone: Today with due chips shows every heading, chip and line, and nothing scrolls sideways', async ({ page, signIn, employee, me, myDocuments }, testInfo) => {
    noBackendOnly();
    phoneOnly(testInfo);
    const fx: Fx = { page, signIn, employee, me, myDocuments };
    const due = addDays(TODAY, -30); // the longest words: "Overdue by 30 days"
    await openToday(fx, { answer: listOf({ NATIONAL_ID: 'NOT_UPLOADED', BANK_CONFIRMATION: 'SENT_BACK' }), documentsDue: due });
    for (const type of REQUIRED_TYPES) await expectChipOn(page, type, due);
    expect(page.viewportSize()!.width, 'a phone').toBeLessThanOrEqual(400);
    expect(await hiddenOrCovered(page), 'Today: nothing hidden, covered or under the top bar').toEqual([]);
    expect(await wordsFullyShown(page), 'Today: every chip and date line shows all its words').toEqual([]);
    expect(await sidewaysScroll(page), 'Today: nothing scrolls sideways').toEqual([]);

    for (const [d, words] of [[addDays(TODAY, 3), 'Due in 3 days'], [TODAY, 'Due today']] as const) {
      await reloadWith(fx, d);
      expect(await chipsIn(row(page, 'NATIONAL_ID')).then((c) => c.map((x) => x.text)), `the ${words} chip`).toEqual([words]);
      expect(await hiddenOrCovered(page), `Today (${words}): nothing hidden or covered`).toEqual([]);
      expect(await wordsFullyShown(page), `Today (${words}): nothing cut short`).toEqual([]);
    }
  });

  test('AC-6 Phone: HR home with an overdue person shows every card whole, and nothing scrolls sideways', async ({ page, signIn, hr, api }, testInfo) => {
    noBackendOnly();
    phoneOnly(testInfo);
    const longName: Made = { first: 'Nomvula', last: 'Khoza-Vanderwesthuizen', step: 'DOCUMENTS', stage: 'ACTIVE', due: addDays(TODAY, -45), overdueBy: 45 };
    api!.people = [WHO[0]!, WHO[1]!, WHO[2]!, WHO[3]!, WHO[6]!, longName].map(personOf);
    await openHome(page, signIn, hr);
    await expect(personRows(page)).toHaveCount(6);
    await expect(attentionLines(page)).toHaveCount(1);
    expect(page.viewportSize()!.width).toBeLessThanOrEqual(400);
    expect(await hiddenOrCovered(page), 'HR home: nothing hidden, covered or under the top bar').toEqual([]);
    expect(await wordsFullyShown(page), 'HR home: every overdue line shows all its words').toEqual([]);
    expect(await sidewaysScroll(page), 'HR home: nothing scrolls sideways').toEqual([]);

    // The overdue line sits in the person's own card, under the step word, inside the card.
    const shapes = await personRows(page).evaluateAll((trs) =>
      trs.map((tr) => {
        const box = tr.getBoundingClientRect();
        const t = tr.querySelector('time[datetime]')?.getBoundingClientRect();
        return t ? { inside: t.left >= box.left - 1 && t.right <= box.right + 1 && t.top >= box.top - 1 && t.bottom <= box.bottom + 1, words: (tr.querySelector('time[datetime]') as HTMLElement).innerText.trim() } : null;
      }),
    );
    const withChip = shapes.filter(Boolean);
    expect(withChip.length, 'four people are overdue').toBe(4);
    for (const s of withChip) expect(s!.inside, `"${s!.words}" is inside its card`).toBe(true);
  });

  // ================================================================ AC-7 keyboard and screen reader

  test('AC-7 The chip is a <time datetime> with the full date in its title, its words are in the row, and axe finds no serious issue on Today', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    test.setTimeout(3 * 60_000);
    const fx: Fx = { page, signIn, employee, me, myDocuments };
    for (const [due, label] of [[addDays(TODAY, -2), 'overdue'], [addDays(TODAY, 2), 'soon'], [addDays(TODAY, 9), 'later']] as const) {
      if (label === 'overdue') await openToday(fx, { answer: listOf({ NATIONAL_ID: 'NOT_UPLOADED', BANK_CONFIRMATION: 'SENT_BACK' }), documentsDue: due });
      else await reloadWith(fx, due);
      const want = chipFor(due, TODAY);
      for (const type of REQUIRED_TYPES) {
        const [chip] = await chipsIn(row(page, type));
        expect(chip!.tag, `${label}: the chip is a <time> element`).toBe('TIME');
        expect(chip!.datetime, `${label}: datetime holds the date`).toBe(due);
        expect(chip!.title ?? '', `${label}: the title has the full date "${want.dateText}"`).toContain(want.dateText);
        const snap = await row(page, type).ariaSnapshot();
        expect(snap, `${label}: a screen reader reads "${want.words}" in the ${NAMES[type]} row`).toContain(want.words);
        expect(snap, `${label}: and the date line "${dueLine(want.dateText)}"`).toContain(dueLine(want.dateText));
        await expect(row(page, type)).toContainText(want.words);
      }
      expect(await seriousAxe(page), `axe on Today with a ${label} chip`).toEqual([]);
    }
  });

  test('AC-7 axe finds no serious or critical issue on HR home with an overdue person', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    api!.people = WHO.map(personOf);
    await openHome(page, signIn, hr);
    await expect(personRows(page)).toHaveCount(WHO.length);
    await expect(attentionLines(page)).toHaveCount(1);
    expect(await seriousAxe(page), 'axe on HR home').toEqual([]);

    // A screen reader reads the overdue count with the Documents count, and the line with the person.
    const tree = await page.locator('body').ariaSnapshot();
    expect(tree, 'the overdue count is in the page for a screen reader').toContain(overdueCount(4));
    expect(tree, 'and the line against a person').toContain('Overdue by 2 days');
    for (const r of await readHome(page)) if (r.chips.length) {
      expect(r.chips[0]!.tag, `${r.name}: the line is a <time> element`).toBe('TIME');
      expect(r.chips[0]!.datetime, `${r.name}: with the due date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  // ================================================================ AC-8 pepla-dev

  test('AC-8 pepla-dev: HR home counts who is overdue and shows "Overdue by n days" against Pieter, never against Mwila @pepla-dev', async ({ page, signIn, hr }, testInfo) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only, after ONB-10 is merged and deployed there.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once, at one width.');
    test.setTimeout(240_000);
    const aiCalls: string[] = [];
    page.on('request', (r) => { if (/\/agent\/v1\/|\/summary|risk-report|assess-risk|bedrock|textract/i.test(r.url())) aiCalls.push(r.url()); });
    const today = johannesburgDay(new Date());

    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(HR_HOME);
    await expect(personRows(page).first()).toBeVisible({ timeout: 30_000 });

    // Every page of the table.
    const rows: HomeRow[] = [];
    for (let n = 0; n < 50; n++) {
      rows.push(...(await readHome(page)));
      const next = page.getByRole('button', { name: 'Next page', exact: true }).or(page.getByRole('link', { name: 'Next page', exact: true }));
      if (!(await next.count()) || !(await next.first().isEnabled())) break;
      const before = (await readHome(page)).map((r) => r.name).join();
      await next.first().click();
      await expect.poll(async () => (await readHome(page)).map((r) => r.name).join()).not.toBe(before);
    }
    const MON: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Oct: '10', Nov: '11', Dec: '12', Sep: '09' };
    const isoOfShown = (s: string): string => {
      const m = /^(\d{1,2}) ([A-Z][a-z]{2}) (\d{4})$/.exec(s);
      return m ? `${m[3]}-${MON[m[2]!]}-${m[1]!.padStart(2, '0')}` : '';
    };

    // The rule, worked out here from each person's own start date, step and today's date.
    let expectedOverdue = 0;
    for (const r of rows) {
      const stepCode = Object.entries(STEP_WORD).find(([, w]) => w === r.step)?.[0];
      const due = dueFor(isoOfShown(r.start));
      const late = isOverdue(stepCode, due, today);
      if (late) {
        expectedOverdue++;
        expect(r.note, `${r.name} (${r.step}, starts ${r.start}, due ${due}): overdue by ${chipFor(due, today).days} days`).toEqual([chipWords('overdue', chipFor(due, today).days)]);
      } else {
        expect(r.note, `${r.name} (${r.step}, starts ${r.start}): no overdue line`).toEqual([]);
      }
    }
    const line = stat(page, 'Documents').locator('.pp-stat__meta--attention');
    if (expectedOverdue > 0) await expect(line, `the Documents count says ${overdueCount(expectedOverdue)}`).toHaveText(new RegExp(`^\\s*${overdueCount(expectedOverdue)}\\s*$`));
    else await expect(attentionLines(page), 'nobody is overdue today').toHaveCount(0);

    // The seeded people: Pieter's start date is 10 Nov 2026 (due 3 Nov), so he is always overdue; Mwila starts in 2030.
    const pieter = rows.find((r) => r.name === 'Pieter van Wyk');
    expect(pieter, 'Pieter van Wyk is in the table').toBeTruthy();
    expect(pieter!.start, 'the seed gives Pieter a start date of 10 Nov 2026').toBe('10 Nov 2026');
    expect(pieter!.step, 'Pieter is at Documents').toBe('Documents');
    expect(pieter!.note, 'Pieter is overdue by the days since 3 Nov 2026').toEqual([chipWords('overdue', chipFor('2026-11-03', today).days)]);
    const mwila = rows.find((r) => r.name === 'Mwila Phiri');
    expect(mwila, 'Mwila Phiri is in the table').toBeTruthy();
    expect(mwila!.start, 'the seed gives Mwila a start date of 1 Jan 2030').toBe('1 Jan 2030');
    expect(mwila!.note, 'Mwila is never overdue').toEqual([]);
    expect(aiCalls, 'no call to any AI route').toEqual([]);
  });

  test('AC-8 pepla-dev: the employee test login\'s checklist shows a due chip for 24 Nov 2026 on a required document still to give @pepla-dev', async ({ page, signIn, employee }, testInfo) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only, after ONB-10 is merged and deployed there.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once, at one width.');
    test.setTimeout(240_000);
    const aiCalls: string[] = [];
    page.on('request', (r) => { if (/\/agent\/v1\/|\/summary|risk-report|assess-risk|bedrock|textract/i.test(r.url())) aiCalls.push(r.url()); });
    const today = johannesburgDay(new Date());

    await signIn.open();
    await signIn.signInAs(employee);
    await expect(page).toHaveURL(START_PATH, { timeout: 30_000 });
    await expect(welcome(page, employee.givenName)).toBeVisible();
    const tick = page.getByRole('checkbox', { name: /^I have read and agree to the declaration above/ });
    await expect(tick.or(checklistHeading(page)), 'the consent form or the checklist').toBeVisible({ timeout: 30_000 });
    if (await tick.isVisible()) {
      await tick.check();
      await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
    }
    await expect(checklistHeading(page)).toBeVisible({ timeout: 30_000 });

    // The test login starts on 1 Dec 2026: its documents are due 24 Nov 2026.
    const due = '2026-11-24';
    let withChip = 0;
    for (const type of REQUIRED_TYPES) {
      const r = row(page, type);
      const word = (await r.innerText()).includes(STATE_WORD.NOT_UPLOADED) ? 'give' : (await r.innerText()).includes(STATE_WORD.SENT_BACK) ? 'give' : 'wait';
      if (word === 'give') {
        await expectChipOn(page, type, due, today);
        withChip++;
      } else {
        await expectNoChip(page, type, 'on a document that is with HR or accepted');
      }
    }
    expect(withChip, 'the seed leaves the test login at least one required document still to give').toBeGreaterThan(0);
    for (const type of OPTIONAL_TYPES) await expectNoChip(page, type, 'on an optional document');
    expect(aiCalls, 'no call to any AI route').toEqual([]);
  });

  // ================================================================ AC-9 text and scope check

  test('AC-9 The rule lives in one module used by both Lambdas; the Lambdas that must not change do not; no new route, IAM line or AI', async ({}, testInfo) => {
    onceOnly(testInfo);
    const read = (f: string) => readFileSync(join(REPO, f), 'utf8');

    // The one module, used by getEmployees and getMyStart, and no second copy of the rule in either.
    expect(existsSync(join(REPO, 'lambda/shared/due-date.mjs')), 'lambda/shared/due-date.mjs exists').toBe(true);
    for (const fn of ['getEmployees', 'getMyStart']) {
      const src = stripComments(read(`lambda/${fn}/index.mjs`));
      expect(src, `${fn} imports documentsDueDate from the shared module`).toMatch(/import\s*\{[^}]*\bdocumentsDueDate\b[^}]*\}\s*from\s*['"]\.\.\/shared\/due-date\.mjs['"]/);
      expect(src, `${fn} calls documentsDueDate`).toMatch(/\bdocumentsDueDate\s*\(/);
      expect(src, `${fn} does not do date maths of its own`).not.toMatch(/\bsetUTCDate\b|\bsetDate\b|\bgetUTCDate\b|86_?400_?000|\b24\s*\*\s*60\s*\*\s*60|Date\.UTC|\.getTime\(\)/);
      expect(src, `${fn} does not hold its own "7"`).not.toMatch(/[-−]\s*7\b|\b7\s*\*|DUE_DAYS|DAYS_BEFORE/);
    }
    const shared = stripComments(read('lambda/shared/due-date.mjs'));
    expect(shared, 'the module holds the number once').toMatch(/DOCUMENTS_DUE_DAYS_BEFORE_START\s*=\s*7/);
    expect(shared, 'dueDaysFor takes the company (today it ignores it, as requiredFor does)').toMatch(/export\s+function\s+dueDaysFor\s*\(\s*_?\w+/);
    expect(shared, 'the module calls no AWS service').not.toMatch(/@aws-sdk|aws-lambda-powertools/);

    // getReviewDocumentVerification and generateDocumentUploadUrl are as they were.
    const pinned = JSON.parse(readFileSync(join(HERE, 'support', 'onb-10', 'unchanged-8b6ad7d.json'), 'utf8')) as { files: Record<string, string> };
    for (const [file, sha] of Object.entries(pinned.files)) {
      expect(createHash('sha256').update(readFileSync(join(REPO, file))).digest('hex'), `${file} is unchanged`).toBe(sha);
    }

    // getMyDocuments has no due date: not the type, not the person (ONB-06 AC-6 and ONB-20 keep its fields).
    const w = docsWorld({
      consents: [consentRow(LINDIWE_ID, String(exportsOf(NOTICE_MODULE)['CURRENT_NOTICE_VERSION']), T0)],
      docs: [docRow({ id: 'doc_1731830000000', type: 'NATIONAL_ID', status: 'MANUAL_REVIEW', uploaded: '2026-11-10T08:15:00.000Z' })],
    });
    const docs = listMyDocuments(w, LINDIWE);
    expect(docs.status, `GET /v1/me/documents answers (${docs.raw.slice(0, 200)})`).toBe(200);
    expect(JSON.stringify(docs.body), 'the documents answer holds no due date, in any name').not.toMatch(/due|overdue|deadline/i);
    expect(docs.raw, 'and not the date').not.toContain('2026-11-24');
    expect(storedEmployee()['planned_start_date'], 'the stored person does start on 1 Dec 2026').toEqual({ S: '2026-12-01' });

    // No new route about due dates; no new IAM line on the two roles that changed.
    const infra = join(REPO, 'infra');
    const keys = readdirSync(infra).filter((f) => f.endsWith('.tf')).flatMap((f) => [...stripComments(readFileSync(join(infra, f), 'utf8')).matchAll(/route_key\s*=\s*"([^"]+)"/g)].map((m) => m[1]!));
    expect(keys.filter((k) => /due|overdue|deadline/i.test(k)), 'no route for due dates').toEqual([]);
    const was = JSON.parse(readFileSync(join(HERE, 'support', 'onb-10', 'iam-8b6ad7d.json'), 'utf8')) as Record<string, string[]>;
    for (const fn of Object.keys(was)) {
      const now = rolePairsOf(fn);
      expect(now.found, `${fn}: its Lambda and role are in Terraform`).toBe(true);
      expect(now.pairs.filter((p) => !was[fn]!.includes(p)), `${fn}: no new IAM line`).toEqual([]);
    }

    // The OpenAPI spec lists both new fields, and neither is required.
    const field = (path: string, f: string) => JSON.parse(execFileSync('python3', [join(HERE, 'support', 'onb-10', 'openapi_field.py'), join(REPO, 'api', 'openapi.yaml'), path, 'get', '200', f], { encoding: 'utf8' })) as { found: boolean; type?: unknown; required?: boolean };
    const due = field('/v1/employees', 'items[].documents_due');
    expect(due.found, 'GET /v1/employees lists items[].documents_due').toBe(true);
    expect(due.type, 'documents_due is text').toBe('string');
    const mine = field('/v1/me', 'documentsDue');
    expect(mine.found, 'GET /v1/me 200 lists documentsDue').toBe(true);
    expect(mine.type, 'documentsDue is text').toBe('string');
    expect(mine.required, 'documentsDue is optional (it is left out when there is no start date)').toBe(false);

    // The seed gives Pieter and Mwila their start dates (the pepla-dev checks depend on it).
    const seed = read('scripts/ci/seed-dev.py');
    expect(seed, 'the seed has 2026-11-10 (Pieter)').toContain('2026-11-10');
    expect(seed, 'the seed has 2030-01-01 (Mwila)').toContain('2030-01-01');
    expect(seed, 'the others, and the test employee, keep 2026-12-01').toContain('2026-12-01');

    // Sunbird's help pictures: on the fixed help day nobody is overdue, so HR home shows no line and the locked pictures hold.
    const helpDay = '2026-03-02';
    const lateOnHelpDay = HELP_NEW_EMPLOYEES.filter((p) => isOverdue(({ INVITED: 'INVITED', ACTIVE: 'DOCUMENTS', DOCUMENTS_SUBMITTED: 'IN_REVIEW', VERIFIED: 'VERIFIED' } as Record<string, string>)[p.stage], dueFor(p.planned_start_date), helpDay));
    expect(lateOnHelpDay.map((p) => p.first_name), 'nobody at Sunbird Bakery is overdue on the help day (2 Mar 2026)').toEqual([]);
  });

  test('AC-9 The words and the parts: only the card\'s words, no "Masked", "Work email" or "password", only pp-* on screens, no paid AI anywhere', async ({}, testInfo) => {
    onceOnly(testInfo);
    const files = [
      'pepla-web/src/app/core/deadline.ts',
      'pepla-web/src/app/features/start/documents-checklist.ts',
      'pepla-web/src/app/features/hr/hr-home.page.ts',
      'lambda/shared/due-date.mjs',
      'lambda/getEmployees/index.mjs',
      'lambda/getMyStart/index.mjs',
    ];
    for (const f of files) {
      expect(existsSync(join(REPO, f)), `${f} exists`).toBe(true);
      const text = readFileSync(join(REPO, f), 'utf8');
      expect(text, `${f}: never "Masked"`).not.toMatch(/\bmasked\b/i);
      expect(text, `${f}: never "Work email"`).not.toMatch(/work email/i);
      expect(text, `${f}: never "password"`).not.toMatch(/password/i);
      expect(text, `${f}: never the words the design system forbids`).not.toMatch(/\bSLA\b|breached|at risk/i);
      expect(text, `${f}: imports no AI client`).not.toMatch(/(from|import)\s*\(?\s*['"`][^'"`]*(bedrock|textract|anthropic|openai)/i);
    }

    // The words are worked out in one function: the app's pages ask it and spell none of them out.
    const deadline = readFileSync(join(REPO, 'pepla-web/src/app/core/deadline.ts'), 'utf8');
    for (const w of ['Due in', 'Due today', 'Overdue by']) expect(deadline, `deadline.ts holds "${w}" (W-1)`).toContain(w);
    for (const f of ['pepla-web/src/app/features/start/documents-checklist.ts', 'pepla-web/src/app/features/hr/hr-home.page.ts']) {
      const t = readFileSync(join(REPO, f), 'utf8');
      expect(t, `${f} uses deadlineOf from core/deadline`).toMatch(/\bdeadlineOf\b/);
      expect(t, `${f} imports it from core/deadline`).toMatch(/from\s+['"][^'"]*core\/deadline['"]|from\s+['"]\.\.\/\.\.\/core\/deadline['"]/);
      expect(t, `${f} does not spell out the deadline words itself`).not.toMatch(/Overdue by|Due in|Due today/);
    }
    expect(readFileSync(join(REPO, 'pepla-web/src/app/features/hr/hr-home.page.ts'), 'utf8'), 'HR home says "overdue" (W-3)').toMatch(/overdue/);
    expect(existsSync(join(WEB, 'src', 'app', 'core', 'deadline.spec.ts')), 'deadline.ts has its own unit test next to it (ng test)').toBe(true);
    expect(existsSync(join(REPO, 'lambda', 'shared', 'due-date.test.mjs')), 'due-date.mjs has its own unit test next to it (npm test in lambda/shared)').toBe(true);

    try {
      execFileSync('node', ['scripts/verify-design.mjs'], { cwd: WEB, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      throw new Error(`verify:design failed:\n${err.stdout ?? ''}${err.stderr ?? ''}`);
    }
  });
});
