import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { ON_DEV, avatarButton, type SignInPage } from './support/fixtures';
import type { CognitoFake } from './support/cognito-fake';
import { FAILING_MODES, type ModulesFake } from './support/mod-02/modules-fake';
import { navLabels, openNav } from './support/mod-02/shell-snapshot';
import { WHO, enter, iso, quiet, type HireFake, type Stage, type Who } from './support/rec-ui/harness';
import { NEVER, RW, addCand, expect, main, openRecord, personHeader, detailsCard, readHeader, readPath, test, type RecordFake } from './support/rec-ui-02/record';
import { BLOCK_WORDS, DROPPED, HIRED_KIT, HW, employeePath, hiredBlock, hiredRecords, openLink, readBlock } from './support/rec-ui-02/hired';

/**
 * REC-UI-02 step 5 · The Hired block on the candidate record: a Recruiter opening a candidate hired through an accepted offer sees
 * that the employee record exists and can go straight to that person in Onboarding. Jira NH-280 (part "Hired block (AC-10, F-18)",
 * epic NH-223, amber). Lock acceptance-lock/rec-ui-02.6, one squashed commit on develop 4ac3b23 with the two moved lines of
 * rec-ui-02-record.spec.ts (AC-R8, AC-R9). Spec: onboarding-cards/specs/REC-UI-02-later-steps.md section 2 (rules 1 to 5, AC-H1 to
 * AC-H9), its checks -spec-check-r1.md and -r2.md, decision D-RUI-02.31. Where the spec is silent, cards/rec-ui-02.6.md says what
 * these tests take (T-H1 to T-H6); T-H1: the kit draws the block as a success pp-section-message, not a pp-card, and the kit wins.
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg (the harness clock).
 * AC-H9 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 */

const phone = () => test.info().project.name === 'phone-390';
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');

type Fx = { page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null; record: RecordFake | null };
const fxOf = (a: Fx): Fx => a;
const DAY = 86_400_000;
const KAGISO = 'cand-kagiso';
const EMP = 'emp-0f3c2a71-kagiso';

async function asRecruiter(fx: Fx, who: Who = WHO.recruiterA): Promise<void> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
}
const cand = (hire: HireFake, id: string) => hire.world.cands.find((c) => c.id === id)!;

/** Kagiso Molefe (kit "Candidate: hired"), moved to Hired three days ago, with this employee id on his record. */
function hiredKagiso(fx: Fx, employeeId: string | null = EMP): ReturnType<typeof hiredRecords> {
  const k = cand(fx.hire!, KAGISO);
  k.stage = 'HIRED';
  k.stage_entered_at = iso(fx.hire!.world.now - 3 * DAY);
  const h = hiredRecords(fx.record!);
  h.set(KAGISO, { employee_id: employeeId });
  return h;
}

/** The page's main text and title hold none of the block's words, and no link goes to an employee page. */
async function noBlock(page: Page, where: string, onRecord = true): Promise<void> {
  await quiet(page);
  await expect(hiredBlock(page), `${where}: no block`).toHaveCount(0);
  await expect(openLink(page), `${where}: no "Open in Onboarding"`).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: HW.open }), `${where}: no "Open in Onboarding" button`).toHaveCount(0);
  // Off the record (sent away to /hr), the HR page's own people list links to employees; only the record must have none.
  if (onRecord) await expect(main(page).locator('a[href*="/hr/employees"]'), `${where}: no link to an employee page`).toHaveCount(0);
  const text = `${await main(page).innerText()} ${await page.title()}`;
  expect(text, `${where}: none of the block's words`).not.toMatch(BLOCK_WORDS);
}

/** Every attribute and text node of the document that holds `value`. */
async function placesOf(page: Page, value: string): Promise<string[]> {
  return page.evaluate((v) => {
    const out: string[] = [];
    for (const el of [document.documentElement, ...document.querySelectorAll('*')]) {
      for (const a of [...el.attributes]) if (a.value.includes(v)) out.push(`${el.tagName.toLowerCase()}[${a.name}="${a.value}"]`);
      for (const n of [...el.childNodes]) if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').includes(v)) out.push(`text in ${el.tagName.toLowerCase()}`);
    }
    if (document.title.includes(v)) out.push('tab title');
    return [...new Set(out)];
  }, value);
}

// ================================================================ AC-H1 Shows (rules 1 and 2)
test.describe('AC-H1 Shows', () => {
  test.beforeEach(noBackendOnly);

  test('AC-H1 Hired, employee_id set, Onboarding on: the block shows "Employee record created", "Onboarding opened for Kagiso Molefe." and the one link "Open in Onboarding", on the Overview before Candidate details', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page } = fx;
    hiredKagiso(fx);
    await asRecruiter(fx);
    await openRecord(page, KAGISO);
    await expect(hiredBlock(page)).toBeVisible();
    const b = await readBlock(page);
    expect(b.title).toBe(HW.title);
    expect(b.body, 'the body is the one line, nothing more').toBe(HW.line('Kagiso', 'Molefe'));
    expect(b.links.map((l) => l.text), 'one link, "Open in Onboarding"').toEqual([HW.open]);
    expect(b.buttons, 'no button in the block').toEqual([]);
    expect(b.role, 'a region named by its title, as the kit draws it').toBe('region');
    expect(b.labelledBy).toBe('title');
    await expect(main(page).getByRole('region', { name: HW.title, exact: true })).toHaveCount(1);
    // On the Overview: after the tab strip and before the Candidate details card (rule 2, the first thing on Overview).
    expect(await main(page).getByRole('tab', { name: RW.overview }).getAttribute('aria-selected')).toBe('true');
    const order = await page.evaluate(() => {
      const m = document.querySelector('main')!;
      const block = [...m.querySelectorAll('.pp-section-message')].find((e) => /Employee record created/.test(e.textContent ?? ''));
      const tabs = m.querySelector('[role="tablist"]');
      const details = [...m.querySelectorAll('.pp-card')].find((e) => (e.querySelector('.pp-card__title')?.textContent ?? '').trim() === 'Candidate details');
      const before = (a: Element | null | undefined, b: Element | null | undefined) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { afterTabs: before(tabs, block), beforeDetails: before(block, details), insidePersonHeader: !!block?.closest('.pp-person-header') };
    });
    expect(order).toEqual({ afterTabs: true, beforeDetails: true, insidePersonHeader: false });
    // The rest of the record is as before: the Hired lozenge, every step done, the details card.
    const h = await readHeader(page);
    expect([h.name, h.lozenge?.words]).toEqual(['Kagiso Molefe', RW.hired]);
    expect((await readPath(page)).every((s) => s.state === 'done')).toBe(true);
    await expect(detailsCard(page)).toBeVisible();
  });

  test('AC-H1 The block stays on Overview only: choosing Interviews or Notes hides it, back on Overview it shows again', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page } = fx;
    hiredKagiso(fx);
    await asRecruiter(fx);
    await openRecord(page, KAGISO);
    await expect(hiredBlock(page)).toBeVisible();
    for (const tab of ['Interviews', 'Notes']) {
      await main(page).getByRole('tab', { name: tab }).click();
      await quiet(page);
      await expect(hiredBlock(page), `${tab}: no block`).toHaveCount(0);
      await main(page).getByRole('tab', { name: RW.overview }).click();
      await expect(hiredBlock(page), 'back on Overview').toBeVisible();
    }
  });
});

// ================================================================ AC-H2 Absent (rule 1)
test.describe('AC-H2 Absent', () => {
  test.beforeEach(noBackendOnly);

  test('AC-H2 Every stage but Hired (Applied, Screening, Interview, Offer, Not hired) shows no block, though the answer carries an employee_id', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    const h = hiredRecords(fx.record!);
    const stages: Stage[] = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'NOT_HIRED'];
    for (const s of stages) {
      addCand(hire!, { id: `cand-h2-${s.toLowerCase()}`, name: `Lindiwe ${s === 'NOT_HIRED' ? 'Nothired' : s[0] + s.slice(1).toLowerCase()}`, stage: s });
      h.set(`cand-h2-${s.toLowerCase()}`, { employee_id: EMP });
    }
    await asRecruiter(fx);
    for (const s of stages) {
      await openRecord(page, `cand-h2-${s.toLowerCase()}`);
      await expect(personHeader(page)).toBeVisible();
      await noBlock(page, s);
    }
  });

  test('AC-H2 Hired with employee_id missing, or "", shows no block; the lozenge and path are as today', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    const h = hiredRecords(fx.record!);
    for (const [id, v] of [['cand-h2-none', null], ['cand-h2-empty', '']] as const) {
      addCand(hire!, { id, name: 'Zanele Mokoena', stage: 'HIRED', stage_entered_at: iso(hire!.world.now - 2 * DAY) });
      h.set(id, { employee_id: v });
    }
    await asRecruiter(fx);
    for (const id of ['cand-h2-none', 'cand-h2-empty']) {
      await openRecord(page, id);
      expect((await readHeader(page)).lozenge?.words, id).toBe(RW.hired);
      expect((await readPath(page)).every((s) => s.state === 'done'), id).toBe(true);
      await noBlock(page, id);
    }
  });

  test('AC-H2 An old-system hired row (legacy_hired: true, no employee_id) shows the lozenge and path as today and no block', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    const h = hiredRecords(fx.record!);
    addCand(hire!, { id: 'cand-h2-legacy', name: 'Themba Ndlovu', stage: 'HIRED', stage_entered_at: iso(hire!.world.now - 400 * DAY) });
    h.set('cand-h2-legacy', { employee_id: null, legacy_hired: true });
    await asRecruiter(fx);
    await openRecord(page, 'cand-h2-legacy');
    expect((await readHeader(page)).lozenge?.words).toBe(RW.hired);
    expect((await readPath(page)).every((s) => s.state === 'done')).toBe(true);
    await noBlock(page, 'legacy hired');
  });

  test('AC-H2 Onboarding off for the company: the record opens and shows no block', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, modules } = fx;
    hiredKagiso(fx);
    modules!.answers.A = ['recruitment'];
    await asRecruiter(fx);
    await openRecord(page, KAGISO);
    expect((await readHeader(page)).name).toBe('Kagiso Molefe');
    await noBlock(page, 'Onboarding off');
  });

  test('AC-H2 The modules read fails: a read that fails while the record is open takes the block away; a failing read as the page loads keeps the record away and shows no block (fails closed)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, modules, hire } = fx;
    hiredKagiso(fx);
    await asRecruiter(fx);
    await openRecord(page, KAGISO);
    await expect(hiredBlock(page)).toBeVisible();
    // The app keeps a good modules read for a minute (ModulesService). Two minutes on, the next navigation inside the record (the
    // address's tab, no reload) reads the modules again, and that read fails.
    for (const mode of [FAILING_MODES[0]!, 'offline' as const]) {
      modules!.mode = mode;
      const before = modules!.calls.length;
      hire!.world.now += 2 * 60_000;
      await page.clock.setFixedTime(hire!.world.now);
      await page.evaluate((id) => { history.pushState({}, '', `/hire/candidates/${id}?tab=overview`); dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, KAGISO);
      await expect.poll(() => modules!.calls.length, `${mode}: the modules were read again`).toBeGreaterThan(before);
      await quiet(page);
      await expect(hiredBlock(page), `${mode}: the block is gone after the failed read`).toHaveCount(0);
      await expect(openLink(page)).toHaveCount(0);
      modules!.mode = 'ok';
      hire!.world.now += 2 * 60_000;
      await page.clock.setFixedTime(hire!.world.now);
      await openRecord(page, KAGISO);
      await expect(hiredBlock(page), 'a good read again shows the block again').toBeVisible();
    }
    // A failing read from the start: the record is not reached, and no block shows wherever the app sends the person.
    modules!.mode = 'forbidden';
    hire!.world.now += 2 * 60_000;
    await page.clock.setFixedTime(hire!.world.now);
    await page.goto(`/hire/candidates/${KAGISO}`);
    await quiet(page);
    await expect(page, 'a failed modules read keeps the Recruiter off the record').not.toHaveURL(new RegExp(`/hire/candidates/${KAGISO}`));
    await noBlock(page, 'modules read failed at load', false);
  });
});

// ================================================================ AC-H3 The link (rule 3)
test.describe('AC-H3 The link', () => {
  test.beforeEach(noBackendOnly);

  test('AC-H3 "Open in Onboarding" is a link to /hr/employees/{employee_id}, the id URL-encoded; clicking it opens that address', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page } = fx;
    const odd = 'emp 42/7#b?x%';
    hiredKagiso(fx, odd);
    await asRecruiter(fx);
    await openRecord(page, KAGISO);
    await expect(openLink(page)).toHaveCount(1);
    await expect(main(page).getByRole('button', { name: HW.open })).toHaveCount(0);
    expect(await openLink(page).evaluate((a) => a.tagName)).toBe('A');
    expect(await openLink(page).getAttribute('href')).toBe(employeePath(odd));
    await openLink(page).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(employeePath(odd));
    await expect(hiredBlock(page)).toHaveCount(0);
  });

  test('AC-H3 The link is reachable by keyboard: Tab from the top of the page gets to it and Enter opens the employee page', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page } = fx;
    hiredKagiso(fx);
    await asRecruiter(fx);
    await openRecord(page, KAGISO);
    await expect(openLink(page)).toBeVisible();
    await quiet(page);
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await openLink(page).evaluate((a) => a === document.activeElement);
    }
    expect(reached, 'Tab reaches "Open in Onboarding"').toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).pathname).toBe(employeePath(EMP));
  });

  test('AC-H3 The link follows the record on screen: going from one hired candidate to another inside the app (no reload) links each to its own employee', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    const h = hiredKagiso(fx);
    addCand(hire!, { id: 'cand-h3-other', name: 'Ayanda Khumalo', stage: 'HIRED', stage_entered_at: iso(hire!.world.now - DAY) });
    h.set('cand-h3-other', { employee_id: 'emp-77d1-ayanda' });
    addCand(hire!, { id: 'cand-h3-none', name: 'Sizwe Mabaso', stage: 'HIRED', stage_entered_at: iso(hire!.world.now - DAY) });
    h.set('cand-h3-none', { employee_id: null });
    await asRecruiter(fx);
    await openRecord(page, KAGISO);
    expect(await openLink(page).getAttribute('href')).toBe(employeePath(EMP));
    const go = (id: string) => page.evaluate((x) => { history.pushState({}, '', `/hire/candidates/${x}`); dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, id);
    await go('cand-h3-other');
    await expect.poll(async () => (await readHeader(page)).name).toBe('Ayanda Khumalo');
    await expect(openLink(page)).toHaveAttribute('href', employeePath('emp-77d1-ayanda'));
    expect((await readBlock(page)).body).toBe(HW.line('Ayanda', 'Khumalo'));
    await go('cand-h3-none');
    await expect.poll(async () => (await readHeader(page)).name).toBe('Sizwe Mabaso');
    await noBlock(page, 'a hired candidate with no employee_id after one with');
    await go(KAGISO);
    await expect.poll(async () => (await readHeader(page)).name).toBe('Kagiso Molefe');
    await expect(openLink(page)).toHaveAttribute('href', employeePath(EMP));
  });
});

// ================================================================ AC-H4 The trimmed words (D-RUI-02.31)
test.describe('AC-H4 The trimmed words', () => {
  test.beforeEach(noBackendOnly);

  test('AC-H4 "notified", "Laptop", "access now sit with" and no HR person\'s or hiring manager\'s name appear on the record (D-RUI-02.31)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    hiredKagiso(fx);
    await asRecruiter(fx);
    await openRecord(page, KAGISO);
    await quiet(page);
    const names = [...Object.values(WHO).map((w) => w.full), ...Object.values(hire!.world.options.A.hiring_managers ?? []).map((m) => m.name), 'Thandeka Dlamini'];
    const text = await main(page).innerText();
    for (const re of DROPPED) expect(text, `no ${re}`).not.toMatch(re);
    const blockText = (await hiredBlock(page).count()) ? await hiredBlock(page).innerText() : '';
    for (const n of names) expect(blockText, `the block names nobody: ${n}`).not.toContain(n);
    for (const n of names) expect(text, `the record names no HR person or manager: ${n}`).not.toContain(n);
  });
});

// ================================================================ AC-H5 Names (rule 2)
test.describe('AC-H5 Names', () => {
  test.beforeEach(noBackendOnly);

  test('AC-H5 First and last name with spaces around them read trimmed, joined by one space', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, record } = fx;
    hiredKagiso(fx);
    record!.set(KAGISO, { firstName: '   Kagiso  ', lastName: '  Molefe   ' });
    await asRecruiter(fx);
    await openRecord(page, KAGISO);
    await expect(hiredBlock(page)).toBeVisible();
    const raw = await hiredBlock(page).locator('.pp-section-message__body').evaluate((el) => (el.textContent ?? '').trim());
    expect(raw, 'one space between the names, none around them').toBe('Onboarding opened for Kagiso Molefe.');
  });

  test('AC-H5 Both names empty (null, "" or spaces): no "Onboarding opened" line; the title and the link still show', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, record } = fx;
    hiredKagiso(fx);
    await asRecruiter(fx);
    for (const [first, last] of [[null, null], ['', ''], ['  ', '\u00a0']] as const) {
      record!.set(KAGISO, { firstName: first, lastName: last });
      await openRecord(page, KAGISO);
      await expect(hiredBlock(page), `${JSON.stringify([first, last])}: the block shows`).toBeVisible();
      const b = await readBlock(page);
      expect(b.title).toBe(HW.title);
      expect(b.body, 'no "Onboarding opened" line').not.toMatch(/Onboarding opened/);
      expect(b.body, 'nothing else in its place').toBe('');
      expect(b.links.map((l) => [l.text, l.href])).toEqual([[HW.open, employeePath(EMP)]]);
      expect(await main(page).innerText()).not.toMatch(/\b(null|undefined)\b|for \./);
    }
  });
});

// ================================================================ AC-H6 The id is not drawn (rule 3, the moved AC-R9 line)
test.describe('AC-H6 The id is not drawn', () => {
  test.beforeEach(noBackendOnly);

  test('AC-H6 The employee_id appears in exactly one place: the href of "Open in Onboarding"; never as text, in the tab title, a title, data-* or aria-* attribute', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page } = fx;
    for (const id of [EMP, NEVER.employee_id]) {
      hiredKagiso(fx, id);
      if (id === EMP) await asRecruiter(fx);
      await openRecord(page, KAGISO);
      await expect(hiredBlock(page)).toBeVisible();
      await quiet(page);
      expect(await placesOf(page, id), id).toEqual([`a[href="${employeePath(id)}"]`]);
      const html = await page.content();
      expect(html.split(id).length - 1, `${id}: once in the whole page`).toBe(1);
      expect(`${await page.locator('body').innerText()} ${await page.title()}`).not.toContain(id);
    }
  });
});

// ================================================================ AC-H7 Company B (rule 5, safety)
test.describe('AC-H7 Company B', () => {
  test.beforeEach(noBackendOnly);

  test('AC-H7 A Recruiter of company B (Recruitment on for this test) typing A\'s hired candidate id sees only "This candidate could not be found.": no block, no link, nothing of A', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, modules, record } = fx;
    hiredKagiso(fx);
    modules!.answers.B = ['onboarding', 'recruitment'];
    await asRecruiter(fx, WHO.recruiterB);
    await openRecord(page, KAGISO);
    await expect(main(page).getByText(RW.notFound, { exact: true })).toBeVisible();
    await expect(personHeader(page)).toHaveCount(0);
    await noBlock(page, 'B on A\'s hired candidate');
    const html = await page.content();
    for (const n of ['Kagiso', 'Molefe', EMP]) expect(html, n).not.toContain(n);
    const last = record!.reads(KAGISO).at(-1)!;
    expect([last.email, last.status]).toEqual([WHO.recruiterB.email, 404]);
  });

  test('AC-H7 A\'s Recruiter on A\'s hired record signs out with the app\'s Sign out and B\'s Recruiter signs in on the page the app left (no reload): B\'s own hired record links to B\'s employee, and A\'s id reached inside the app shows "This candidate could not be found."; nothing of A at any moment', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, signIn, cognito, modules, hire, record } = fx;
    const h = hiredKagiso(fx);
    const b1 = cand(hire!, 'cand-b1');
    b1.stage = 'HIRED';
    b1.stage_entered_at = iso(hire!.world.now - DAY);
    const EMP_B = 'emp-b-5520-hlengiwe';
    h.set('cand-b1', { employee_id: EMP_B });
    await asRecruiter(fx);
    await openRecord(page, KAGISO);
    await expect(openLink(page)).toHaveAttribute('href', employeePath(EMP));
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    // From here on, any trace of A in the page or the tab title is written down the moment it appears.
    const aWords = ['Kagiso', 'Molefe', EMP];
    await page.evaluate((words) => {
      const seen: string[] = [];
      (window as unknown as { __seenA: string[] }).__seenA = seen;
      const check = () => {
        const all = `${document.documentElement.outerHTML} ${document.title}`;
        for (const w of words) if (all.includes(w)) seen.push(`${w} at ${location.pathname}`);
      };
      new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
      check();
    }, aWords);
    const seenA = () => page.evaluate(() => (window as unknown as { __seenA?: string[] }).__seenA ?? ['the watcher is gone: the page was loaded again']);
    modules!.answers.B = ['onboarding', 'recruitment'];
    const who = WHO.recruiterB;
    if (cognito!.subOf(who.email) === undefined) cognito!.addAccount(who);
    modules!.assign(who.email, who.company);
    hire!.assign(who);
    await signIn.signInAs(who);
    await expect(page).toHaveURL(who.lands!);
    record!.refuse({ hold: true, id: 'cand-b1' });
    await page.evaluate(() => { history.pushState({}, '', '/hire/candidates/cand-b1'); dispatchEvent(new PopStateEvent('popstate', { state: {} })); });
    await expect.poll(() => record!.heldCount).toBe(1);
    await page.waitForTimeout(500);
    expect(await seenA(), 'nothing of A while B\'s answer is on its way').toEqual([]);
    await expect(hiredBlock(page), 'no block before B\'s answer').toHaveCount(0);
    record!.release();
    await expect.poll(async () => (await personHeader(page).count()) && (await readHeader(page)).name).toBe('Hlengiwe Sibiya');
    await expect(openLink(page)).toHaveAttribute('href', employeePath(EMP_B));
    expect((await readBlock(page)).body).toBe(HW.line('Hlengiwe', 'Sibiya'));
    record!.refuse({ hold: true, id: KAGISO });
    await page.evaluate((id) => { history.pushState({}, '', `/hire/candidates/${id}`); dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, KAGISO);
    await expect.poll(() => record!.heldCount).toBe(1);
    await page.waitForTimeout(500);
    expect(await seenA(), 'nothing of A while the answer for A\'s id is on its way').toEqual([]);
    record!.release();
    await expect(main(page).getByText(RW.notFound, { exact: true })).toBeVisible();
    await noBlock(page, 'A\'s id as B');
    expect(await seenA(), 'nothing of A at any moment').toEqual([]);
    const last = record!.reads(KAGISO).at(-1)!;
    expect([last.email, last.status]).toEqual([WHO.recruiterB.email, 404]);
  });
});

// ================================================================ AC-H8 Look and kit match (rules 2 and 4)
test.describe('AC-H8 Look and kit match', () => {
  test.beforeEach(noBackendOnly);

  const DS = join(__dirname, '..', '..', 'src', 'styles', 'design-system');
  const known = (): Set<string> => new Set(['components.css', 'tokens/base.css'].flatMap((f) => readFileSync(join(DS, f), 'utf8').match(/\.pp-[a-z0-9_-]+/g) ?? []).map((c: string) => c.slice(1)));
  const kit = () => HIRED_KIT.screens[phone() ? 'Candidate: hired (phone)' : 'Candidate: hired'];

  test('AC-H8 The kit was read at 6f59033: its block is a success section message with "Employee record created", the two dropped lines, and "Open in Onboarding"', async () => {
    expect(HIRED_KIT.ref).toBe('6f590331e17787484c7a3ed96b6043f6ac92d55f');
    for (const s of Object.values(HIRED_KIT.screens)) {
      expect(s.words).toEqual([HW.title, 'Onboarding opened for Kagiso Molefe. Thandeka Dlamini notified.', 'Laptop and access now sit with Kagiso in Onboarding.', HW.open]);
      expect(s.tags[0]).toBe('div.pp-section-message.pp-section-message--success');
    }
  });

  test('AC-H8 The block matches kit "Candidate: hired" (and its phone frame): the same pp-* classes, a success section message with its title, body and actions, the link styled as the kit\'s small default button, and only design system parts', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page } = fx;
    hiredKagiso(fx);
    await asRecruiter(fx);
    await openRecord(page, KAGISO);
    await expect(hiredBlock(page)).toBeVisible();
    const b = await readBlock(page);
    const k = kit();
    expect(k.classes.filter((c) => !b.classes.includes(c)), 'classes the kit block has and the app block lacks').toEqual([]);
    const have = known();
    expect(b.classes.filter((c) => !have.has(c)), 'every pp-* class exists in the design system').toEqual([]);
    // Only the kit's own parts: no other tone, no dismiss, no card, no extra button look (T-H2).
    expect(b.classes.filter((c) => !(k.classes as readonly string[]).includes(c) && !/^pp-icon/.test(c)), 'no pp-* class the kit block does not have').toEqual([]);
    const shape = await hiredBlock(page).first().evaluate((el) => ({
      title: el.querySelector(':scope > .pp-section-message__content > .pp-section-message__title')?.tagName.toLowerCase() ?? null,
      body: !!el.querySelector(':scope > .pp-section-message__content > .pp-section-message__body'),
      actions: [...el.querySelectorAll(':scope > .pp-section-message__content > .pp-section-message__actions > *')].map((a) => `${a.tagName.toLowerCase()}.${[...a.classList].filter((c) => c.startsWith('pp-')).sort().join('.')}`),
      icon: !!el.querySelector(':scope > svg, :scope > i'),
      linkIcon: !!el.querySelector('.pp-section-message__actions a > svg, .pp-section-message__actions a > i'),
      other: [...new Set([...el.querySelectorAll('*')].flatMap((e) => [...e.classList]).filter((c) => !/^(pp-|ng-|lucide)/.test(c)))],
      styled: [...el.querySelectorAll('[style]')].map((e) => e.tagName.toLowerCase()),
    }));
    expect(shape).toEqual({ title: 'h3', body: true, actions: ['a.pp-button.pp-button--default.pp-button--small'], icon: true, linkIcon: true, other: [], styled: [] });
  });

  test('AC-H8 At 390 the block, its title and the link are visible, not under the top bar and not cut off; the link fills the width as the kit phone draws it; nothing scrolls sideways', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    test.skip(!phone(), 'Phone only: the criterion is the 390 wide screen');
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page } = fx;
    hiredKagiso(fx);
    await asRecruiter(fx);
    await openRecord(page, KAGISO);
    await expect(hiredBlock(page)).toBeVisible();
    await quiet(page);
    const problems = await page.evaluate(async () => {
      const out: string[] = [];
      const width = document.documentElement.clientWidth;
      const bar = document.querySelector('pp-top-navigation')?.getBoundingClientRect();
      const block = [...document.querySelectorAll('main .pp-section-message')].find((e) => /Employee record created/.test(e.textContent ?? '')) as HTMLElement;
      const parts: Array<[string, HTMLElement | null]> = [['block', block], ['title', block.querySelector('.pp-section-message__title')], ['body', block.querySelector('.pp-section-message__body')], ['link', block.querySelector('a')]];
      for (const [label, el] of parts) {
        if (!el) { out.push(`${label} missing`); continue; }
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) out.push(`${label} has no size`);
        if (r.left < -1 || r.right > width + 1) out.push(`${label} is cut off sideways (${Math.round(r.left)} to ${Math.round(r.right)})`);
        if (bar && r.top < bar.bottom - 1 && r.bottom > 0) out.push(`${label} is under the top bar`);
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') out.push(`${label} is clipped`);
        const x = Math.min(Math.max(r.left + r.width / 2, 1), width - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        if (hit && !el.contains(hit) && !hit.contains(el)) out.push(`${label} is covered by ${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}`);
      }
      const link = block.querySelector('a');
      const row = block.querySelector('.pp-section-message__actions');
      if (link && row) {
        const a = link.getBoundingClientRect(), w = row.getBoundingClientRect();
        if (a.width < w.width - 2) out.push(`the link is ${Math.round(a.width)} wide in a ${Math.round(w.width)} wide row (the kit phone draws it full width)`);
      }
      window.scrollTo(0, 0);
      if (document.documentElement.scrollWidth > width + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide)`);
      return out;
    });
    expect(problems).toEqual([]);
  });
});

// ================================================================ AC-H9 pepla-dev (judged after merge)
test.describe('AC-H9 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-H9 runs on pepla-dev only.');
  // seed_rec_ui_02_6 in scripts/ci/seed-dev.py writes one hired candidate and its employee per width (cards/rec-ui-02.6.md).
  const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-ui-02', 'hired-dev-ids.json'), 'utf8')) as Record<'desk' | 'phone', { candidate: string; employee: string; firstName: string; lastName: string }>;
  const mine = () => ids[phone() ? 'phone' : 'desk'];

  test('AC-H9 @pepla-dev The HR login opens the seeded hired candidate: the block shows, and "Open in Onboarding" lands on that employee\'s page', async ({ page, signIn, hr }) => {
    const s = mine();
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto(`/hire/candidates/${s.candidate}`);
    await expect.poll(async () => (await personHeader(page).count()) && (await readHeader(page)).name).toBe(`${s.firstName} ${s.lastName}`);
    expect((await readHeader(page)).lozenge?.words).toBe(RW.hired);
    await expect(hiredBlock(page)).toBeVisible();
    expect((await readBlock(page)).body).toBe(HW.line(s.firstName, s.lastName));
    await expect(openLink(page)).toHaveAttribute('href', employeePath(s.employee));
    await openLink(page).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(employeePath(s.employee));
    await expect(page).toHaveTitle(new RegExp(`${s.lastName}`));
    await expect(main(page).getByText('This employee could not be found.', { exact: true })).toHaveCount(0);
  });

  test('AC-H9 @pepla-dev Company B\'s HR login typing the seeded hired candidate\'s address sees "This candidate could not be found." (Recruitment on) or is sent away (off); no block and nothing of A. A skip here is not a pass', async ({ page, signIn }) => {
    const email = process.env['E2E_B_HR_EMAIL'], password = process.env['E2E_B_HR_PASSWORD'];
    test.skip(!email || !password, 'E2E_B_HR_EMAIL and E2E_B_HR_PASSWORD are not set: the company B part cannot run (a skip is not a pass).');
    const s = mine();
    await signIn.open();
    await signIn.signInAs({ email: email!, password: password! });
    await expect(page).toHaveURL('/hr');
    await openNav(page);
    const recruitmentOn = (await navLabels(page)).includes('Candidates');
    await page.goto(`/hire/candidates/${s.candidate}`);
    await quiet(page);
    if (recruitmentOn) await expect(main(page).getByText(RW.notFound, { exact: true })).toBeVisible();
    else await expect(page).toHaveURL('/hr');
    await noBlock(page, 'company B');
    const html = await page.content();
    for (const n of [s.lastName, s.employee]) expect(html).not.toContain(n);
  });
});
