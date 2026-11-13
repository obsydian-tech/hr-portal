import AxeBuilder from '@axe-core/playwright';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { HELP_NEW_EMPLOYEES } from '../fixtures/help-company';
import { EmployeesFake, apiPerson, keyOfPage, type ApiPerson } from './support/employees-fake';
import { HR_HOME, ON_DEV, expect, test as base } from './support/fixtures';
import { attributes, blocks, tfFiles } from './support/infra-harness';
import { WEB, WIDTHS, helpRun, passedOnBoth, pictureDiff, runJourney, signInReference, startFront, type Run } from './support/journey-harness';

/**
 * ONB-02 · HR home: who is starting (Jira NH-155, epic NH-150).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-02.md (approved 13 Nov 2026)
 *
 * Each test runs at 1280 and 390 wide (projects in ./playwright.config.ts).
 * No-backend run: the browser answers GET <employeesApiUrl>/v1/employees with
 * made-up people (support/employees-fake.ts) and Cognito with the fake.
 * Tests tagged @pepla-dev also run against pepla-dev with the seeded people.
 *
 * These files are locked once Iggie accepts them: see ./README.md.
 */

const STEPS = ['Invited', 'Documents', 'In review', 'Verified'] as const;
type Step = (typeof STEPS)[number] | 'Not set';

/** The card's mapping from the stored stage to the step shown, until ONB-09. */
const STEP_OF: Record<string, Step> = {
  INVITED: 'Invited',
  ACTIVE: 'Documents',
  DOCUMENTS_SUBMITTED: 'In review',
  VERIFIED: 'Verified',
  TRAINING: 'Verified',
  ONBOARDED: 'Verified',
};
const stepOf = (p: ApiPerson): Step => STEP_OF[p.stage] ?? 'Not set';
const nameOf = (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`;

const LOAD_FAILED = 'New employees could not be loaded.';
const NONE_YET = 'No new employees yet.';
const NO_MATCH = 'No new employees match';
const SEARCH = 'Search by name or email';

// ---------------------------------------------------------------- dates

/** Today in South Africa, as YYYY-MM-DD, the same day the browser sees (timezone Africa/Johannesburg). */
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());
const daysFromToday = (n: number): string => {
  const d = new Date(`${TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------- made-up people

/**
 * Eleven people: every stored stage, an unknown stage and an empty one, start
 * dates and none, HR partners and none, and phone numbers and ID digits that
 * must never show.
 */
function mixedPeople(): ApiPerson[] {
  return [
    apiPerson({ first_name: 'Lerato', last_name: 'Mokoena', department: 'Sales', stage: 'INVITED', planned_start_date: '2026-12-01', phone: '+27 82 941 7736', id_number_last4: '8642' }),
    apiPerson({ first_name: 'Pieter', last_name: 'van Wyk', email: 'pvw.ops@gmail.com', department: 'Operations', stage: 'ACTIVE', planned_start_date: '2027-01-15', hr_staff_name: '', phone: '+27 71 302 5519', id_number_last4: '9753' }),
    apiPerson({ first_name: 'Naledi', last_name: 'Dlamini', department: 'Finance', stage: 'DOCUMENTS_SUBMITTED', planned_start_date: '', phone: '+27 83 660 2184', id_number_last4: '1357' }),
    apiPerson({ first_name: 'Tendai', last_name: 'Moyo', department: 'Engineering', stage: 'VERIFIED', planned_start_date: '2026-11-30', hr_staff_name: 'Sam Peters', phone: '+27 60 718 4402', id_number_last4: '2468' }),
    apiPerson({ first_name: 'Chipo', last_name: 'Banda', department: 'People', stage: 'TRAINING', planned_start_date: '2027-02-03', id_number_last4: '3579' }),
    apiPerson({ first_name: 'Ayesha', last_name: 'Patel', department: 'Marketing', stage: 'ONBOARDED', planned_start_date: '2027-03-22' }),
    apiPerson({ first_name: 'Kagiso', last_name: 'Nkosi', department: 'Sales', stage: 'ACTIVE', planned_start_date: '2026-12-14' }),
    apiPerson({ first_name: 'Mwila', last_name: 'Phiri', department: 'Operations', stage: 'INVITED', planned_start_date: '2027-04-06' }),
    apiPerson({ first_name: 'Bongani', last_name: 'Zulu', department: 'Operations', stage: 'ARCHIVED', planned_start_date: '2027-05-11' }),
    apiPerson({ first_name: 'Zanele', last_name: 'Khumalo', department: 'Finance', stage: '', planned_start_date: '2027-06-08' }),
    apiPerson({ first_name: 'Sibusiso', last_name: 'Ndlovu', department: 'Engineering', stage: 'INVITED', planned_start_date: '2027-07-20' }),
  ];
}

/** The card's own counts for a list of people. */
function countsOf(people: ApiPerson[]): Record<(typeof STEPS)[number], number> {
  const out = { Invited: 0, Documents: 0, 'In review': 0, Verified: 0 };
  for (const p of people) {
    const s = stepOf(p);
    if (s !== 'Not set') out[s]++;
  }
  return out;
}

/** AC-3: start dates from today on (soonest first), then earlier ones (most recent first), then none; ties by name. */
function cardOrder(people: ApiPerson[]): ApiPerson[] {
  const group = (p: ApiPerson) => (!p.planned_start_date ? 2 : p.planned_start_date >= TODAY ? 0 : 1);
  return [...people].sort((a, b) => {
    const g = group(a) - group(b);
    if (g) return g;
    const da = a.planned_start_date;
    const db = b.planned_start_date;
    const byDate = group(a) === 0 ? da.localeCompare(db) : group(a) === 1 ? db.localeCompare(da) : 0;
    return byDate || nameOf(a).localeCompare(nameOf(b), 'en');
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "1 Dec 2026", or "Not set". The made-up dates avoid September, whose short name varies. */
const shownDate = (iso: string) => {
  if (!iso) return 'Not set';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
};

// ---------------------------------------------------------------- the page, found by its words

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

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs made-up people.');

function table(page: Page): Locator {
  return page.getByRole('table', { name: 'New employees', exact: true });
}
/** Rows that are people: they hold the link to the person's page. */
function personRows(page: Page): Locator {
  return table(page).locator('tbody tr').filter({ has: page.locator('a[href*="/hr/employees/"]') });
}
function searchBox(page: Page): Locator {
  return page.getByRole('searchbox', { name: SEARCH, exact: true });
}
function statValue(page: Page, label: string): Locator {
  const label_ = page.locator('.pp-stat__label').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
  return page.locator('.pp-stat').filter({ has: label_ }).locator('.pp-stat__value');
}

type ShownRow = { name: string; href: string; first: string; department: string; step: string; start: string; partner: string; text: string };

async function readRows(page: Page): Promise<ShownRow[]> {
  return personRows(page).evaluateAll((trs) =>
    trs.map((tr) => {
      const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
      const a = tr.querySelector('a[href*="/hr/employees/"]') as HTMLAnchorElement;
      const cells = [...tr.querySelectorAll('td')].map((td) => clean((td as HTMLElement).innerText));
      const name = clean(a.innerText);
      return {
        name,
        href: a.getAttribute('href') ?? '',
        first: cells[0] ?? '',
        department: clean((cells[0] ?? '').replace(name, '')),
        step: cells[1] ?? '',
        start: cells[2] ?? '',
        partner: cells[3] ?? '',
        text: clean((tr as HTMLElement).innerText),
      };
    }),
  );
}

async function expectCounts(page: Page, want: Record<string, number>): Promise<void> {
  for (const label of STEPS) await expect(statValue(page, label), `count "${label}"`).toHaveText(String(want[label]));
}

async function openHome(page: Page, signIn: import('./support/fixtures').SignInPage, hr: { email: string; password: string }): Promise<void> {
  await signIn.open();
  await signIn.signInAs(hr);
  await expect(page).toHaveURL(HR_HOME);
}

/** Every person row on every page of the table, following Next page. */
async function allRowsOnAllPages(page: Page): Promise<ShownRow[]> {
  const rows: ShownRow[] = [];
  for (let n = 0; n < 50; n++) {
    rows.push(...(await readRows(page)));
    const next = page.getByRole('button', { name: 'Next page', exact: true }).or(page.getByRole('link', { name: 'Next page', exact: true }));
    if (!(await next.count()) || !(await next.first().isEnabled())) break;
    const before = (await readRows(page)).map((r) => r.href).join();
    await next.first().click();
    await expect.poll(async () => (await readRows(page)).map((r) => r.href).join()).not.toBe(before);
  }
  return rows;
}

// ---------------------------------------------------------------- tests

test.describe('ONB-02 HR home: who is starting', () => {
  test('AC-1 Four counts by step, across all pages @pepla-dev', async ({ page, signIn, hr, api }) => {
    if (api) {
      api.people = mixedPeople();
      api.pageSizes = [4, 4, 3]; // page 1 alone would give 1, 1, 1, 1
      await openHome(page, signIn, hr);
      await expect(personRows(page)).toHaveCount(api.people.length);
      await expectCounts(page, countsOf(api.people)); // 3, 2, 1, 3: the "Not set" two count nowhere
      return;
    }

    // pepla-dev: the counts equal the table's rows of each step, and the seeded people show their step.
    await openHome(page, signIn, hr);
    await expect(personRows(page).first()).toBeVisible({ timeout: 20_000 });
    const rows = await allRowsOnAllPages(page);
    const want: Record<string, number> = { Invited: 0, Documents: 0, 'In review': 0, Verified: 0 };
    for (const r of rows) if (r.step in want) want[r.step]!++;
    await expectCounts(page, want);
    const seeded: Array<[string, Step]> = [
      ['Lerato Mokoena', 'Invited'],
      ['Pieter van Wyk', 'Documents'],
      ['Naledi Dlamini', 'In review'],
      ['Tendai Moyo', 'Verified'],
      ['Chipo Banda', 'Verified'],
      ['Ayesha Patel', 'Verified'],
    ];
    for (const [name, step] of seeded) {
      const row = rows.find((r) => r.name === name);
      expect(row, `${name} is in the table`).toBeTruthy();
      expect(row!.step, `${name}'s step`).toBe(step);
    }
  });

  test('AC-2 Each row shows name, department, step, start date and HR partner, and never a phone number or ID digits', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    const people = mixedPeople();
    api!.people = people;
    await openHome(page, signIn, hr);
    await expect(personRows(page)).toHaveCount(people.length);

    const headers = await table(page).locator('thead th').allInnerTexts();
    expect(headers.map((h) => h.replace(/\s+/g, ' ').trim()).filter(Boolean), 'the columns').toEqual(['Employee', 'Step', 'Start date', 'HR partner']);

    const rows = await readRows(page);
    for (const p of people) {
      const row = rows.find((r) => r.name === nameOf(p));
      expect(row, `${nameOf(p)} has a row, named first and last`).toBeTruthy();
      expect(row!.department, `${nameOf(p)}: department under the name`).toBe(p.department);
      expect(row!.step, `${nameOf(p)}: step`).toBe(stepOf(p));
      expect(row!.start, `${nameOf(p)}: start date`).toBe(shownDate(p.planned_start_date));
      expect(row!.partner, `${nameOf(p)}: HR partner`).toBe(p.hr_staff_name || 'Not assigned');
    }

    // The department sits under the name, in the same cell.
    const first = personRows(page).first();
    const nameBox = (await first.locator('a[href*="/hr/employees/"]').boundingBox())!;
    const deptBox = (await first.locator('td').first().getByText(people.find((p) => nameOf(p) === rows[0]!.name)!.department, { exact: true }).boundingBox())!;
    expect(deptBox.y, 'department is below the name').toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 2);

    // No phone number and no ID digits anywhere: not in the text, not in any attribute.
    const text = await page.locator('body').innerText();
    const html = await page.content();
    const digits = text.replace(/\D/g, '');
    for (const p of people) {
      if (p.phone) {
        const local = p.phone.replace(/\D/g, '').slice(2); // without +27
        expect(digits.includes(local), `${nameOf(p)}'s phone number is not on the page`).toBe(false);
        expect(html.replace(/\D/g, '').includes(local), `${nameOf(p)}'s phone number is not in the page source`).toBe(false);
      }
      if (p.id_number_last4) {
        expect(text, `${nameOf(p)}'s ID digits are not on the page`).not.toMatch(new RegExp(`\\b${p.id_number_last4}\\b`));
        expect(html, `${nameOf(p)}'s ID digits are not in the page source`).not.toMatch(new RegExp(`\\b${p.id_number_last4}\\b`));
      }
    }
  });

  test('AC-3 Who starts next comes first: from today on soonest first, then earlier most recent first, then no date; ties by name', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    // The API sorts by created_at, not start date: here, the opposite of the card's order.
    const people = [
      apiPerson({ first_name: 'Ayanda', last_name: 'Bam', planned_start_date: '' }),
      apiPerson({ first_name: 'Zola', last_name: 'Shezi', planned_start_date: '' }),
      apiPerson({ first_name: 'Fikile', last_name: 'Mahlaba', planned_start_date: daysFromToday(-30) }),
      apiPerson({ first_name: 'Elias', last_name: 'Nel', planned_start_date: daysFromToday(-1) }),
      apiPerson({ first_name: 'Carla', last_name: 'Botha', planned_start_date: daysFromToday(-1) }),
      apiPerson({ first_name: 'Dineo', last_name: 'Radebe', planned_start_date: daysFromToday(40) }),
      apiPerson({ first_name: 'Bheki', last_name: 'Mthembu', planned_start_date: daysFromToday(3) }),
      apiPerson({ first_name: 'Andile', last_name: 'Cele', planned_start_date: daysFromToday(3) }),
      apiPerson({ first_name: 'Amahle', last_name: 'Dube', planned_start_date: TODAY }),
    ].reverse();
    api!.people = people;
    await openHome(page, signIn, hr);
    await expect(personRows(page)).toHaveCount(people.length);

    const shown = (await readRows(page)).map((r) => r.name);
    expect(shown).toEqual([
      'Amahle Dube', // today
      'Andile Cele', // in 3 days, A before B
      'Bheki Mthembu', // in 3 days
      'Dineo Radebe', // in 40 days
      'Carla Botha', // yesterday, C before E
      'Elias Nel', // yesterday
      'Fikile Mahlaba', // 30 days ago
      'Ayanda Bam', // no date, A before Z
      'Zola Shezi', // no date
    ]);
    expect(shown).toEqual(cardOrder(people).map(nameOf));
  });

  test('AC-4 Search by part of a name or email, any case; counts stay; no match offers Clear search', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    const people = mixedPeople();
    api!.people = people;
    await openHome(page, signIn, hr);
    await expect(personRows(page)).toHaveCount(people.length);
    const counts = countsOf(people);

    const shownNames = async () => (await readRows(page)).map((r) => r.name).sort();
    const search = async (q: string, want: string[]) => {
      await searchBox(page).fill(q);
      await expect.poll(shownNames, `search "${q}"`).toEqual([...want].sort());
      await expectCounts(page, counts);
    };

    await search('mOKo', ['Lerato Mokoena']); // part of a last name, mixed case
    await search('VAN WYK', ['Pieter van Wyk']); // two words of the name
    await search('naledi dl', ['Naledi Dlamini']); // first name and the start of the last
    await search('PVW.OPS@', ['Pieter van Wyk']); // part of an email that is not the name
    await search('@gmail.com', ['Pieter van Wyk']);
    await search('sibusiso.ndlovu@KES', ['Sibusiso Ndlovu']); // the start of an email

    await searchBox(page).fill('xyzzy-nobody');
    await expect(page.getByText(NO_MATCH, { exact: false }).first()).toBeVisible();
    await expect(personRows(page)).toHaveCount(0);
    await expectCounts(page, counts);
    const clear = page.getByRole('button', { name: 'Clear search', exact: true }).filter({ hasText: 'Clear search' });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(personRows(page)).toHaveCount(people.length);
    await expect(searchBox(page)).toHaveValue('');
    await expect(page.getByText(NO_MATCH)).toHaveCount(0);
  });

  test('AC-5 On a phone each person is one card with every detail, and the page never scrolls sideways', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    const people = mixedPeople();
    api!.people = people;
    await openHome(page, signIn, hr);
    await expect(personRows(page)).toHaveCount(people.length);
    const viewport = page.viewportSize()!;
    const phone = viewport.width <= 400;

    const rows = await readRows(page);
    for (const p of people) {
      const r = rows.find((x) => x.name === nameOf(p))!;
      for (const part of [nameOf(p), p.department, stepOf(p), shownDate(p.planned_start_date), p.hr_staff_name || 'Not assigned']) {
        expect(r.text, `${nameOf(p)} shows "${part}"`).toContain(part);
      }
    }

    const shapes = await personRows(page).evaluateAll((trs) =>
      trs.map((tr) => {
        const box = tr.getBoundingClientRect();
        const cells = [...tr.querySelectorAll('td')].map((td) => td.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0);
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          cellsInside: cells.every((c) => c.left >= box.left - 1 && c.right <= box.right + 1 && c.top >= box.top - 1 && c.bottom <= box.bottom + 1),
          stacked: cells.some((c) => c.top >= cells[0]!.bottom - 1),
          oneLine: cells.every((c) => Math.abs(c.top - cells[0]!.top) <= 2),
        };
      }),
    );
    if (phone) {
      for (const [i, s] of shapes.entries()) {
        expect(s.left, `card ${i + 1} inside the screen on the left`).toBeGreaterThanOrEqual(0);
        expect(s.right, `card ${i + 1} inside the screen on the right`).toBeLessThanOrEqual(viewport.width);
        expect(s.right - s.left, `card ${i + 1} is as wide as the list`).toBeGreaterThan(viewport.width * 0.6);
        expect(s.cellsInside, `card ${i + 1} holds all its details`).toBe(true);
        expect(s.stacked, `card ${i + 1} stacks its details, not one table line`).toBe(true);
        if (i > 0) expect(s.top, `card ${i + 1} sits below card ${i}`).toBeGreaterThanOrEqual(shapes[i - 1]!.bottom - 1);
      }
    } else {
      for (const [i, s] of shapes.entries()) expect(s.oneLine, `desktop row ${i + 1} is one table line`).toBe(true);
    }

    // No sideways scroll: not the page, and not a box inside it.
    const sideways = await page.evaluate(() => {
      const out: string[] = [];
      if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
      for (const el of document.querySelectorAll('main *')) {
        const s = getComputedStyle(el);
        if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()}.${el.className} ${el.scrollWidth} > ${el.clientWidth}`);
      }
      return out;
    });
    expect(sideways, 'nothing scrolls sideways').toEqual([]);
  });

  test('AC-6 Each name links to /hr/employees/<id> and opens with the keyboard', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    const people = mixedPeople();
    api!.people = people;
    await openHome(page, signIn, hr);
    await expect(personRows(page)).toHaveCount(people.length);

    for (const p of people) {
      const link = personRows(page).getByRole('link', { name: nameOf(p), exact: true });
      await expect(link, `${nameOf(p)} is a link`).toHaveCount(1);
      const href = (await link.getAttribute('href'))!;
      expect(new URL(href, page.url()).pathname, `${nameOf(p)} opens their page`).toBe(`/hr/employees/${p.employee_id}`);
    }

    // Reach the first person with Tab alone, then open them with Enter.
    const target = cardOrder(people)[0]!;
    await page.evaluate(() => {
      (window as unknown as { __opened: string[] }).__opened = [];
      document.addEventListener('click', (e) => {
        const a = e.target instanceof Element ? e.target.closest('a') : null;
        if (a) (window as unknown as { __opened: string[] }).__opened.push(a.getAttribute('href') ?? '');
      }, true);
      (document.activeElement as HTMLElement | null)?.blur();
    });
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate((name) => {
        const el = document.activeElement;
        return el instanceof HTMLAnchorElement && el.innerText.replace(/\s+/g, ' ').trim() === name;
      }, nameOf(target));
    }
    expect(reached, `Tab reaches ${nameOf(target)}`).toBe(true);
    await page.keyboard.press('Enter');
    const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
    expect(opened.map((h) => new URL(h, 'http://x').pathname), 'Enter opens the person').toEqual([`/hr/employees/${target.employee_id}`]);
  });

  test('AC-7 Every page of the API is read; 20 people per table page with "Showing 1–20 of N new employees"', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    const first = ['Amahle', 'Bongi', 'Carel', 'Dumisani', 'Eunice', 'Farai', 'Gugu', 'Hennie', 'Itumeleng', 'Jabu', 'Karabo', 'Lindiwe', 'Mpho', 'Nandi', 'Oupa', 'Palesa', 'Quinton', 'Refilwe', 'Sizwe', 'Thuli', 'Unathi', 'Vusi', 'Wandile', 'Xolani'];
    const stages = ['INVITED', 'ACTIVE', 'DOCUMENTS_SUBMITTED', 'VERIFIED', 'ONBOARDED', 'INVITED'];
    const people = first.map((f, i) =>
      apiPerson({ first_name: f, last_name: 'Mabaso', stage: stages[i % stages.length]!, planned_start_date: daysFromToday(i * 2 + 1) }),
    );
    api!.people = people;
    api!.pageSizes = [10, 9, 5]; // fewer than the limit per page, as the real API can
    await openHome(page, signIn, hr);
    await expect(page.getByText(`Showing 1–20 of ${people.length} new employees`)).toBeVisible();
    await page.waitForLoadState('networkidle');

    const keys = api!.gets().map((c) => c.url.searchParams.get('lastKey'));
    expect(keys, 'asks again with each lastKey until none comes back, and no more').toEqual([null, keyOfPage(1), keyOfPage(2)]);
    for (const c of api!.gets()) expect(c.authorization, 'every call carries the sign-in token').toMatch(/^Bearer \S+$/);

    await expectCounts(page, countsOf(people));
    const order = cardOrder(people).map(nameOf);
    await expect(personRows(page)).toHaveCount(20);
    expect((await readRows(page)).map((r) => r.name), 'page 1 of the table').toEqual(order.slice(0, 20));

    await page.getByRole('button', { name: 'Next page', exact: true }).or(page.getByRole('link', { name: 'Next page', exact: true })).first().click();
    await expect(page.getByText(`Showing 21–${people.length} of ${people.length} new employees`)).toBeVisible();
    await expect(personRows(page)).toHaveCount(people.length - 20);
    expect((await readRows(page)).map((r) => r.name), 'page 2 of the table').toEqual(order.slice(20));
    await expectCounts(page, countsOf(people));
  });

  test('AC-8 Placeholders while loading (never 0), "No new employees yet.", and a failure with Try again', async ({ page, signIn, hr, api }) => {
    noBackendOnly();

    // Loading: the answer is held back.
    api!.people = mixedPeople();
    api!.mode = 'hold';
    await openHome(page, signIn, hr);
    await expect.poll(() => api!.gets().length, 'HR home asks for the people').toBeGreaterThan(0);
    await expect(page.locator('.pp-skeleton, [aria-busy="true"]').first(), 'placeholders show while loading').toBeVisible();
    const valuesWhileLoading = await page.locator('.pp-stat__value').allInnerTexts();
    expect(valuesWhileLoading.filter((v) => /\d/.test(v)), 'no count shows a number while loading').toEqual([]);
    await expect(page.getByText(NONE_YET)).toHaveCount(0);
    await expect(personRows(page)).toHaveCount(0);
    api!.release();
    await expect(personRows(page)).toHaveCount(api!.people.length);
    await expectCounts(page, countsOf(api!.people));
    await expect(page.locator('.pp-skeleton')).toHaveCount(0);

    // Nobody at all.
    api!.people = [];
    await page.reload();
    await expect(page.getByText(NONE_YET, { exact: true })).toBeVisible();
    await expect(personRows(page)).toHaveCount(0);

    // An error answer, then Try again.
    api!.people = mixedPeople();
    api!.mode = 'error';
    await page.reload();
    await expect(page.getByText(LOAD_FAILED, { exact: true })).toBeVisible();
    await expect(personRows(page)).toHaveCount(0);
    api!.mode = 'ok';
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(personRows(page)).toHaveCount(api!.people.length);
    await expect(page.getByText(LOAD_FAILED)).toHaveCount(0);

    // No connection, then Try again.
    api!.mode = 'offline';
    await page.reload();
    await expect(page.getByText(LOAD_FAILED, { exact: true })).toBeVisible();
    api!.mode = 'ok';
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(personRows(page)).toHaveCount(api!.people.length);
    await expect(page.getByText(LOAD_FAILED)).toHaveCount(0);
  });

  test('AC-9 Signing in and opening HR home calls only Cognito, GET /v1/employees and Google Fonts, never AI', async ({ page, signIn, hr, api, baseURL }) => {
    noBackendOnly();
    const seen: Array<{ method: string; url: URL }> = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') seen.push({ method: r.method(), url });
    });
    api!.people = mixedPeople();
    await openHome(page, signIn, hr);
    await expect(personRows(page)).toHaveCount(api!.people.length);
    await page.waitForLoadState('networkidle');

    const app = new URL(baseURL!).origin;
    const cognito = /^cognito-idp\.[a-z0-9-]+\.amazonaws\.com$/;
    const fonts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
    const outside = seen.filter((s) => s.url.origin !== app && !cognito.test(s.url.hostname) && !fonts.has(s.url.hostname));
    const api_ = outside.filter((s) => /\/v1\/employees$/.test(s.url.pathname));
    expect(api_.length, 'the employees API is called').toBeGreaterThan(0);
    expect(outside.filter((s) => !api_.includes(s)).map((s) => `${s.method} ${s.url.href}`), 'no other host is called').toEqual([]);
    expect([...new Set(api_.map((s) => s.url.origin))].length, 'one employees API').toBe(1);
    expect(api_.filter((s) => s.method !== 'GET' && s.method !== 'OPTIONS').map((s) => `${s.method} ${s.url.pathname}`), 'only GET').toEqual([]);

    const ai = /\/agent\/|\/ai\/|\/chat|batsi|\/summary|assess-risk|risk-report|bedrock|textract|anthropic|openai/i;
    expect(seen.filter((s) => ai.test(s.url.href)).map((s) => s.url.href), 'no AI route is called').toEqual([]);
  });

  test('AC-10 axe finds no serious or critical issue with people loaded; the counts and the "New employees" table have names', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    api!.people = mixedPeople();
    await openHome(page, signIn, hr);
    await expect(personRows(page)).toHaveCount(api!.people.length);

    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help} :: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    expect(bad, 'axe on HR home').toEqual([]);

    await expect(table(page), 'a screen reader reads the table as "New employees"').toBeVisible();
    const counts = countsOf(api!.people);
    const tree = await page.locator('body').ariaSnapshot();
    for (const label of STEPS) {
      await expect(statValue(page, label)).toBeVisible();
      expect(tree, `a screen reader reads "${label}" with its number`).toMatch(new RegExp(`${label}\\W*${counts[label]}\\b`));
    }
  });

  test('AC-11 The new app reaches the employees API on pepla-dev; prod allowed origins do not change @pepla-dev', async ({ page, signIn, hr }) => {
    if (!ON_DEV) {
      // No-backend run: the Terraform as written, for prod and for pepla-dev.
      // The real prod plan on the pull request is read on the verifier's second pass.
      const today = ['http://localhost:4200', 'https://hr-portal-beryl-three.vercel.app'];
      for (const api of ['employees_api', 'document_upload_api']) {
        const prod = allowedOrigins(api, 'prod');
        expect([...prod].sort(), `${api}: prod allows exactly today's origins`).toEqual([...today].sort());
        const dev = allowedOrigins(api, 'dev');
        for (const o of [...today, 'http://localhost:4300', 'http://127.0.0.1:4300']) expect(dev, `${api}: pepla-dev allows ${o}`).toContain(o);
      }
      return;
    }

    const blocked: string[] = [];
    page.on('console', (m) => {
      if (/CORS|Access-Control-Allow-Origin/i.test(m.text())) blocked.push(m.text());
    });
    page.on('requestfailed', (r) => {
      if (/\/v1\/employees/.test(r.url())) blocked.push(`${r.url()}: ${r.failure()?.errorText}`);
    });
    const answered = page.waitForResponse((r) => /\/v1\/employees(\?|$)/.test(r.url()) && r.request().method() === 'GET', { timeout: 30_000 });
    await openHome(page, signIn, hr);
    expect((await answered).status(), 'GET /v1/employees answers 200').toBe(200);
    await expect(personRows(page).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(LOAD_FAILED)).toHaveCount(0);
    expect(blocked, 'the browser blocks no call to the employees API').toEqual([]);
    for (const name of ['Lerato Mokoena', 'Naledi Dlamini', 'Tendai Moyo']) {
      await searchBox(page).fill(name);
      await expect(personRows(page).getByRole('link', { name, exact: true }), `seeded ${name} appears`).toBeVisible();
    }
  });

  test('AC-12 HELP-01 still passes: the sign-in journey answers the API with Sunbird Bakery\'s people only', async ({ page, browser }, testInfo) => {
    test.skip(ON_DEV, 'No-backend run only: the journey answers Cognito with the fake.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs the journey once; it checks the desktop and phone runs itself.');
    testInfo.setTimeout(15 * 60_000);

    const file = join(WEB, 'e2e', 'journeys', 'sign-in.e2e.ts');
    const src = existsSync(file) ? readFileSync(file, 'utf8') : '';
    expect(src, 'the journey reads the new employees from e2e/fixtures/help-company.ts').toMatch(
      /import\s*\{[^}]*\bHELP_NEW_EMPLOYEES\b[^}]*\}\s*from\s*['"]\.\.\/fixtures\/help-company(\.js|\.ts)?['"]/,
    );
    for (const p of HELP_NEW_EMPLOYEES) expect(src, `${nameOf(p)} is not typed into the journey; it comes from the fixture`).not.toContain(p.first_name);

    // Normal run: passes on desktop and phone, with only the app, the Cognito fake, the employees API and the fonts.
    const front = await startFront({ kind: 'plain' });
    let normal: Run;
    try {
      normal = await runJourney('sign-in.e2e.ts', { help: false, base: front.url, tag: 'onb-02-normal' });
    } finally {
      await front.close();
    }
    expect(passedOnBoth(normal), `the sign-in journey passes on desktop and phone\n${normal.output.slice(-1500)}`).toBe(true);

    // Help run: the HR home picture is the help company's HR home, people and counts included.
    const run = await helpRun('sign-in.e2e.ts', 'sign-in', 'onb-02-help');
    expect(passedOnBoth(run), `the help run passes on desktop and phone\n${run.output.slice(-1500)}`).toBe(true);
    for (const width of WIDTHS) {
      const ref = await signInReference(browser, width, 'winter-protea-2026'.length);
      const shot = readFileSync(join(run.dir, width, 'sign-in', '03-hr-home.png'));
      const d = await pictureDiff(page, shot, ref.pictures[2], { content: true });
      expect(d, `[${width}] 03-hr-home shows Sunbird Bakery's new employees, as the reference`).toBeLessThanOrEqual(0.01);
    }
  });
});

// ---------------------------------------------------------------- AC-11: the allowed origins as Terraform would work them out

/**
 * The `allow_origins` of one API's cors_configuration, worked out for an
 * environment. Handles what a plain expression needs: lists, strings,
 * var.environment, local.<name>, == and !=, ? :, and concat / compact /
 * distinct / flatten / tolist / toset. Anything else fails the test, so keep
 * the expression plain.
 */
function allowedOrigins(api: string, environment: 'prod' | 'dev'): string[] {
  const files = tfFiles();
  const resource = blocks(files, 'resource').find((b) => b.labels[0] === 'aws_apigatewayv2_api' && b.labels[1] === api);
  expect(resource, `resource aws_apigatewayv2_api.${api} exists`).toBeTruthy();
  const cors = /cors_configuration\s*\{/.exec(resource!.body);
  expect(cors, `${api} has a cors_configuration block`).toBeTruthy();
  const inner = resource!.body.slice(cors!.index + cors![0].length);
  const expr = attributes(inner.slice(0, closing(inner))).get('allow_origins');
  expect(expr, `${api}: allow_origins is set`).toBeTruthy();

  const locals = new Map<string, string>();
  for (const b of blocks(files, 'locals')) for (const [k, v] of attributes(b.body)) locals.set(k, v);
  let js = expr!;
  for (let i = 0; i < 10 && /local\.\w+/.test(js); i++) {
    js = js.replace(/local\.(\w+)/g, (_, name: string) => {
      expect(locals.has(name), `local.${name} is defined`).toBe(true);
      return `(${locals.get(name)})`;
    });
  }
  js = js.replace(/var\.environment/g, JSON.stringify(environment));
  expect(js, `${api}: allow_origins is a plain expression`).not.toMatch(/\$\{|\bvar\.|\bdata\.|\bmodule\.|\beach\.|\bcount\.|\bfor\b/);
  const uniq = (xs: string[]) => [...new Set(xs)];
  const fns = {
    concat: (...ls: string[][]) => ls.flat(),
    compact: (l: string[]) => l.filter((x) => x !== '' && x != null),
    distinct: uniq,
    flatten: (l: unknown[]) => l.flat(Infinity),
    tolist: (l: string[]) => l,
    toset: uniq,
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const value = new Function(...Object.keys(fns), `"use strict"; return (${js});`)(...Object.values(fns)) as unknown;
  expect(Array.isArray(value), `${api}: allow_origins for ${environment} is a list`).toBe(true);
  return uniq(value as string[]);
}

/** Index of the brace that closes the block whose body starts at 0. */
function closing(body: string): number {
  let depth = 1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') {
      i++;
      while (i < body.length && body[i] !== '"') i += body[i] === '\\' ? 2 : 1;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return body.length;
}
