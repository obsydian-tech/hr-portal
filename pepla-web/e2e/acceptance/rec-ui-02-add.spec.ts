import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { CognitoFake } from './support/cognito-fake';
import { ON_DEV, avatarButton, type SignInPage } from './support/fixtures';
import { navItems, openNav } from './support/mod-02/shell-snapshot';
import { forgetSignIn } from './support/sign-in-again';
import type { ModulesFake } from './support/mod-02/modules-fake';
import { isModulesCall } from './support/mod-02/modules-fake';
import { WHO, companyIdIn, drawsIcon, enter, quiet, signInAs, watchErrors, type HireFake, type Role, type Who } from './support/rec-ui/harness';
import { readRows, recruitmentOn } from './support/rec-ui-02/lists';
import {
  A, A_ROLE_TITLES, GOOD, NEVER_SHOWN, OLD_WORDS, PAGES, addButton, boardNow, cancelButton, choose, chosen, closeButton, createButton, drawer, expect, field, fieldBox, fill,
  linesOf, meet, moreDetails, openDrawer, openMore, openPage, optionsOf, test, type AddFake, type Where,
} from './support/rec-ui-02/add';
import { ADD_KIT } from './support/rec-ui-02/add-kit';

/**
 * REC-UI-02 step 2 · Add candidate (Jira NH-228, epic NH-223, amber). Lock: acceptance-lock/rec-ui-02.1.
 * Spec: onboarding-cards/specs/REC-UI-02-next-slice.md (rules 1 to 10, section 5 A-1 to A-8, AC-1 to AC-17); REC-UI-00.md.
 * Backend: REC-15 step B (PR 506, on develop as da75605). The fake of `POST /v1/candidates` (support/rec-ui-02/add.ts)
 * answers as the real Lambda does and is checked against api/openapi.yaml NewCandidate, NewCandidateAnswer and NewCandidateError.
 * Where the spec is silent, cards/rec-ui-02.1.md writes down what these tests assume (the builder implements exactly that).
 * Words: the kit's, the reused approved lines (D-RUI-02.9) and D-RUI-02.7 only.
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg.
 * AC-17 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 */

const phone = () => test.info().project.name === 'phone-390';
const desktopOnly = (why: string) => test.skip(phone(), `Desktop only: ${why}`);
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');

type Fx = { page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null; add: AddFake | null };

const main = (page: Page): Locator => page.locator('main');

/** Signs in (the add fake is told who they are) and lands on their first page. */
async function enterAs(fx: Fx, who: Who = WHO.recruiterA): Promise<void> {
  meet(fx.hire, who);
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
}

/** Opens a page and the drawer from it. */
async function openFrom(fx: Fx, where: Where, url?: string, heading?: string): Promise<Locator> {
  await openPage(fx.page, where, url, heading);
  return openDrawer(fx.page);
}

const posts = (fx: Fx) => fx.add!.posts;
const listReads = (fx: Fx) => fx.hire!.to('GET', /\/v1\/candidates$/);
const roleReads = (fx: Fx) => fx.hire!.to('GET', /\/v1\/roles$/);
const body = (fx: Fx, i = -1) => posts(fx).at(i)!.body as Record<string, unknown>;
const KEYS = ['email', 'first_name', 'last_name', 'role_id'];

/** The field's own error line: inside its pp-field, below the control. */
async function errorUnder(d: Locator, label: string, line: string): Promise<void> {
  const box = fieldBox(d, label);
  const err = box.getByText(line, { exact: true }).and(box.locator(':not(option)'));
  await expect(err, `"${line}" under ${label}`).toBeVisible();
  const c = (await field(d, label).boundingBox())!;
  const e = (await err.boundingBox())!;
  expect(e.y, `"${line}" sits below the ${label} control`).toBeGreaterThanOrEqual(c.y + c.height - 1);
}

/** The error summary: its heading, its entries in order, and focus on it. */
async function summaryIs(page: Page, d: Locator, entries: Array<[string, string]>): Promise<void> {
  const s = d.locator('.pp-form-error-summary');
  await expect(s).toBeVisible();
  await expect(s.getByRole('heading')).toHaveText(A.summary(entries.length));
  expect((await s.getByRole('listitem').allTextContents()).map((t) => t.trim()), 'one entry per problem, in the order of the fields').toEqual(entries.map(([label, line]) => `${label}: ${line}`));
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.pp-form-error-summary')), 'focus moves to the summary').toBe(true);
}

/** Every typed value is still in the drawer. */
async function kept(d: Locator, f: { first: string; last: string; email: string; phone?: string; source?: string }): Promise<void> {
  await expect(field(d, A.first)).toHaveValue(f.first);
  await expect(field(d, A.last)).toHaveValue(f.last);
  await expect(field(d, A.email)).toHaveValue(f.email);
  if (f.phone !== undefined || f.source !== undefined) await openMore(d);
  if (f.phone !== undefined) await expect(field(d, A.phone)).toHaveValue(f.phone);
  if (f.source !== undefined) expect(await chosen(d, A.source)).toBe(f.source);
}

/** The drawer is gone and focus is back on the page's Add candidate button. */
async function closedWithFocusBack(page: Page): Promise<void> {
  await expect(drawer(page)).toHaveCount(0);
  await expect(addButton(page)).toBeFocused();
  // Focus must stay there once the page has read its list again and redrawn, not only for the first moment.
  await page.waitForTimeout(600);
  await expect(addButton(page), 'focus is still on Add candidate after the page settles').toBeFocused();
}

/** The control half of a "never sees it" test: a Recruiter of A does see the button in this run, then signs out completely. */
async function seenByRecruiterFirst(fx: Fx): Promise<void> {
  await enterAs(fx);
  await openPage(fx.page, 'board');
  await expect(addButton(fx.page), 'control: a Recruiter of A sees it in this run').toBeVisible();
  await forgetSignIn(fx.page);
}

// ================================================================ AC-1 The button (rule 1)
test.describe('AC-1 The button', () => {
  test.beforeEach(noBackendOnly);

  for (const where of ['board', 'list', 'candidates'] as const) {
    test(`AC-1 On the ${where === 'list' ? 'Pipeline list' : where === 'board' ? 'role board' : 'Candidates page'} a Recruiter sees the primary "Add candidate" with the user-plus icon in the header, placed as the kit places it, and it opens the drawer with its title and line`, async ({ page, signIn, cognito, modules, hire, add }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, add };
      const errors = watchErrors(page);
      await enterAs(fx);
      await openPage(page, where);
      const btn = addButton(page);
      await expect(btn).toHaveCount(1);
      await expect(btn).toBeVisible();
      await expect(btn).toHaveClass(/\bpp-button--primary\b/);
      expect(await drawsIcon(btn, 'user-plus'), 'the kit icon').toBe(true);
      // Placed in the header's actions, after the List / Board switch and before the page's More actions (kit order).
      const order = await main(page).locator('.pp-page-header__actions').first().evaluate((box) => [...box.children].map((el) => {
        if (el.matches('.pp-button-group, pp-button-group, [role="group"]') || el.querySelector('[aria-pressed]')) return 'View switch';
        const b = el.matches('button') ? el : el.querySelector('button');
        return (b?.getAttribute('aria-label') || b?.textContent || '').replace(/\s+/g, ' ').trim();
      }));
      expect(order, 'Add candidate is in the page header actions').toContain(A.button);
      const at = order.indexOf(A.button);
      if (order.includes('View switch')) expect(at, 'after the List / Board switch').toBeGreaterThan(order.indexOf('View switch'));
      if (where === 'board') expect(at, 'before More actions for the role').toBeLessThan(order.indexOf('More actions for Fleet controller'));
      if (where === 'candidates') expect(order, 'the only action on Candidates').toEqual([A.button]);
      await btn.click();
      const d = drawer(page);
      await expect(d).toBeVisible();
      await expect(d.getByRole('heading', { level: 2 })).toHaveText(A.title);
      await expect(d.getByText(A.line, { exact: true })).toBeVisible();
      await quiet(page);
      expect(errors, 'no console error').toEqual([]);
    });
  }

  test('AC-1 The board of another open role carries the button too', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    await openPage(page, 'board', '/hire/pipeline?role=role-accountant&view=board', 'Senior accountant');
    await expect(addButton(page)).toBeVisible();
  });
});

// ================================================================ AC-2 The fields (rule 2)
test.describe('AC-2 The fields', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2 The drawer shows, in order: First name, Last name, Email address, Role (placeholder "Choose a role"), the closed "More details" with "Phone, source"; inside it Phone (optional) and Source (optional); then Cancel and Create candidate', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    // Closed at first: Phone and Source are not shown.
    await expect(moreDetails(d)).toBeVisible();
    await expect(field(d, A.phone)).toBeHidden();
    await expect(field(d, A.source)).toBeHidden();
    await expect(moreDetails(d)).toContainText(A.more);
    await expect(moreDetails(d)).toContainText(A.moreMeta);
    await expect(d.locator('.pp-accordion__meta')).toHaveText(A.moreMeta);
    expect(await chosen(d, A.role), 'Role starts on its placeholder').toBe(A.choose);
    expect((await optionsOf(d, A.role))[0], 'the placeholder is the first choice').toBe(A.choose);
    await openMore(d);
    const labels = await d.locator('label.pp-field__label, .pp-field__label').evaluateAll((ls) => ls.filter((l) => (l as HTMLElement).getBoundingClientRect().height > 0).map((l) => (l.textContent ?? '').replace(/\s+/g, ' ').trim()));
    expect(labels.map((l) => l.replace(/\s*\(optional\)$/, ' (optional)')), 'the labels, in order').toEqual(['First name', 'Last name', 'Email address', 'Role', 'Phone (optional)', 'Source (optional)']);
    for (const l of [A.first, A.last, A.email]) await expect(field(d, l)).toHaveValue('');
    await expect(field(d, A.phone)).toHaveAttribute('placeholder', A.phonePlaceholder);
    await expect(field(d, A.phone)).toHaveValue('');
    expect(await optionsOf(d, A.source), 'an empty first choice, then the kit\'s two').toEqual(['', ...A.sources]);
    expect(await chosen(d, A.source), 'nothing chosen').toBe('');
    // Each optional label carries "(optional)" in the design system's own style.
    for (const l of [A.phone, A.source]) await expect(fieldBox(d, l).locator('.pp-field__optional')).toHaveText(A.optional);
    const footer = await d.getByRole('button').evaluateAll((bs) => bs.filter((b) => (b as HTMLElement).getBoundingClientRect().height > 0).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim()));
    expect(footer.filter((t) => [A.cancel, A.create].includes(t as never)), 'Cancel, then Create candidate, as the kit writes them').toEqual(phone() ? expect.arrayContaining([A.cancel, A.create]) : [A.cancel, A.create]);
    await expect(createButton(d)).toHaveClass(/\bpp-button--primary\b/);
    expect(await drawsIcon(createButton(d), 'user-plus')).toBe(true);
    // No CV (D-RUI-02.6) and no location (D-RUI-02.10) anywhere.
    await expect(d.locator('input[type="file"], .pp-file-upload')).toHaveCount(0);
    const text = await d.innerText();
    expect(text).not.toMatch(/\bCV\b|upload|location/i);
  });
});

// ================================================================ AC-3 Open roles only (rule 2, rule 10)
test.describe('AC-3 Open roles only', () => {
  test.beforeEach(noBackendOnly);

  for (const where of ['candidates', 'board'] as const) {
    test(`AC-3 From ${where === 'board' ? 'the board' : 'Candidates'} the Role choices are exactly the job titles of company A's open roles in the answer's order; a closed role and other companies' roles never appear`, async ({ page, signIn, cognito, modules, hire, add }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, add };
      const w = hire!.world;
      w.roles.find((r) => r.role_id === 'role-accountant')!.status = 'CLOSED';
      // An open role that comes first in the answer although it sorts last: the choices keep the answer's order.
      w.roles.unshift({ ...w.roles[0]!, role_id: 'role-yard', job_title: 'Yard marshal', opened_at: '2026-11-01T08:00:00.000Z' } as Role);
      await enterAs(fx);
      await openPage(page, where);
      await quiet(page);
      const before = roleReads(fx).length;
      const d = await openDrawer(page);
      expect(await optionsOf(d, A.role)).toEqual([A.choose, 'Yard marshal', 'Fleet controller', 'Warehouse supervisor']);
      const text = await d.innerText();
      for (const other of ['Senior accountant', 'Dispatch lead', 'Head baker']) expect(text, `${other} is not offered`).not.toContain(other);
      const drawerReads = roleReads(fx).slice(before);
      expect(drawerReads.length, 'the choices come from the roles list').toBeGreaterThanOrEqual(1);
      // Lock check F3: the real list answers every role, closed ones too, when no status is asked (the fake now does the same),
      // so the drawer asks for status=OPEN by name (spec rule 2).
      for (const c of drawerReads) expect(c.query['status'], 'GET /v1/roles?status=OPEN').toBe('OPEN');
    });
  }
});

// ================================================================ AC-4 Starting role (rule 3)
test.describe('AC-4 Starting role', () => {
  test.beforeEach(noBackendOnly);

  const CASES: Array<[string, Where, string, string, string]> = [
    ['the Fleet controller board', 'board', '/hire/pipeline?role=role-fleet&view=board', 'Fleet controller', 'Fleet controller'],
    ['the Senior accountant board', 'board', '/hire/pipeline?role=role-accountant&view=board', 'Senior accountant', 'Senior accountant'],
    ['the Pipeline list with Warehouse supervisor chosen', 'list', '/hire/pipeline?role=role-warehouse&view=list', 'Pipeline', 'Warehouse supervisor'],
    ['the Pipeline list with All roles', 'list', '/hire/pipeline', 'Pipeline', A.choose],
    ['Candidates with All roles', 'candidates', '/hire/candidates', 'Candidates', A.choose],
  ];
  for (const [label, where, url, heading, start] of CASES) {
    test(`AC-4 Opened from ${label} the Role picker starts on "${start}"`, async ({ page, signIn, cognito, modules, hire, add }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, add };
      await enterAs(fx);
      const d = await openFrom(fx, where, url, heading);
      await expect.poll(() => chosen(d, A.role)).toBe(start);
    });
  }

  test('AC-4 Choosing a role in the Pipeline list\'s Role filter, then opening the drawer, starts on that role', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    await openPage(page, 'list');
    await choose(main(page), 'Role', 'Senior accountant');
    await quiet(page);
    const d = await openDrawer(page);
    await expect.poll(() => chosen(d, A.role)).toBe('Senior accountant');
  });

  test('AC-4 Desktop: Candidates with one role chosen in its Role filter starts on that role', async ({ page, signIn, cognito, modules, hire, add }) => {
    desktopOnly('the kit\'s phone Candidates screen has no Role filter');
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    await openPage(page, 'candidates');
    await choose(main(page), 'Role', 'Warehouse supervisor');
    await quiet(page);
    const d = await openDrawer(page);
    await expect.poll(() => chosen(d, A.role)).toBe('Warehouse supervisor');
  });
});

// ================================================================ AC-5 The notice line (rule 2)
test.describe('AC-5 The notice line', () => {
  test.beforeEach(noBackendOnly);

  test('AC-5 The line is absent while the first name is empty, reads "Amahle gets an email saying what we keep, why and for how long." for "  Amahle ", follows the name, and nothing is sent for it', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    const requests: string[] = [];
    page.on('request', (r) => { if (['fetch', 'xhr'].includes(r.resourceType())) requests.push(`${r.method()} ${new URL(r.url()).pathname}|${r.url()}`); });
    const notice = d.locator('.pp-inline-message');
    await expect(d.getByText(/gets an email saying/)).toHaveCount(0);
    await field(d, A.first).fill('  Amahle ');
    await expect(notice).toHaveText(A.notice('Amahle'));
    // toHaveText folds spaces together, so the name's own spaces are checked on the raw text: trimmed, one space before "gets".
    await expect.poll(async () => ((await notice.textContent()) ?? '').trim(), 'the name is trimmed in the line').toBe(A.notice('Amahle'));
    await expect(d.getByText(A.notice('Amahle'), { exact: true })).toBeVisible();
    await expect(notice.locator('svg, i').first(), 'with the info icon').toBeAttached();
    await field(d, A.first).fill('Thandeka');
    await expect(notice).toHaveText(A.notice('Thandeka'));
    await field(d, A.first).fill('   ');
    await expect(d.getByText(/gets an email saying/), 'only spaces is an empty name').toHaveCount(0);
    await field(d, A.first).fill('');
    await expect(d.getByText(/gets an email saying/)).toHaveCount(0);
    await field(d, A.first).fill('Amahle');
    await fill(d, { last: 'Dlamini', email: 'amahle.d@example.org', role: 'Fleet controller' });
    await expect(notice).toHaveText(A.notice('Amahle'));
    // No email text is shown, and no request but the page's own reads is made for the line.
    expect(await d.innerText()).not.toMatch(/Dear |Subject:|POPIA|we keep your/i);
    await quiet(page);
    const others = requests.filter((r) => { const [mp] = r.split('|'); const url = new URL(r.split('|')[1]!); return !isModulesCall(url) && !/^GET \/v1\/(roles|candidates)(\/options)?$/.test(mp!); });
    expect(others, 'no request but GET /v1/roles and the lists (nothing emails anyone)').toEqual([]);
    expect(posts(fx)).toEqual([]);
  });
});

// ================================================================ AC-6 Checks before sending (rule 4)
test.describe('AC-6 Checks', () => {
  test.beforeEach(noBackendOnly);

  const ONE: Array<[string, Parameters<typeof fill>[1], string, string]> = [
    ['an empty first name', { ...GOOD, first: '' }, A.first, A.firstEmpty],
    ['a first name of only spaces', { ...GOOD, first: '    ' }, A.first, A.firstEmpty],
    ['an empty last name', { ...GOOD, last: '' }, A.last, A.lastEmpty],
    ['an empty email', { ...GOOD, email: '' }, A.email, A.emailEmpty],
    ['an email that is not an address', { ...GOOD, email: 'nandi.khumalo@example' }, A.email, A.emailWrong],
    ['an email with a space in it', { ...GOOD, email: 'nandi khumalo@example.org' }, A.email, A.emailWrong],
    ['no role', { first: GOOD.first, last: GOOD.last, email: GOOD.email }, A.role, A.roleEmpty],
    ['a phone with letters', { ...GOOD, phone: '082 ABC 0000' }, A.phone, A.phoneWrong],
    ['a phone with dashes', { ...GOOD, phone: '082-555-0101' }, A.phone, A.phoneWrong],
    ['a phone of 8 digits', { ...GOOD, phone: '082 555 01' }, A.phone, A.phoneWrong],
    ['a phone of 16 digits', { ...GOOD, phone: '+27 82 555 0101 12345' }, A.phone, A.phoneWrong],
    ['a phone that is only "()"', { ...GOOD, phone: '()' }, A.phone, A.phoneWrong],
    // Lock check F4: a plus sign only at the start.
    ['a phone with a plus sign in the middle', { ...GOOD, phone: '082+555 0101' }, A.phone, A.phoneWrong],
  ];
  for (const [label, form, fieldLabel, line] of ONE) {
    test(`AC-6 ${label} shows "${line}" under ${fieldLabel} and in the summary, focus moves to the summary, nothing is sent; fixing it sends once`, async ({ page, signIn, cognito, modules, hire, add }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, add };
      await enterAs(fx);
      const d = await openFrom(fx, 'candidates');
      await fill(d, form);
      await createButton(d).click();
      await errorUnder(d, fieldLabel, line);
      await summaryIs(page, d, [[fieldLabel, line]]);
      await quiet(page);
      expect(posts(fx), 'nothing is sent').toEqual([]);
      await expect(d).toBeVisible();
      // Fix it and press again: one request, the errors gone.
      if (fieldLabel === A.phone) await field(d, A.phone).fill('082 555 0101');
      else await fill(d, { [fieldLabel === A.first ? 'first' : fieldLabel === A.last ? 'last' : fieldLabel === A.email ? 'email' : 'role']: (GOOD as Record<string, string>)[fieldLabel === A.first ? 'first' : fieldLabel === A.last ? 'last' : fieldLabel === A.email ? 'email' : 'role'] });
      await createButton(d).click();
      await expect.poll(() => posts(fx).length).toBe(1);
      await expect(drawer(page)).toHaveCount(0);
    });
  }

  test('AC-6 An empty form with no role shows four problems in the order of the fields, "Fix 4 things to continue", and sends nothing', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    await createButton(d).click();
    const want: Array<[string, string]> = [[A.first, A.firstEmpty], [A.last, A.lastEmpty], [A.email, A.emailEmpty], [A.role, A.roleEmpty]];
    for (const [l, line] of want) await errorUnder(d, l, line);
    await summaryIs(page, d, want);
    await quiet(page);
    expect(posts(fx)).toEqual([]);
  });

  test('AC-6 Two problems read "Fix 2 things to continue"; an empty optional phone is no problem', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'board');
    await fill(d, { first: 'Nandi', last: '', email: 'nandi@', phone: '' });
    await createButton(d).click();
    await summaryIs(page, d, [[A.last, A.lastEmpty], [A.email, A.emailWrong]]);
    await expect(fieldBox(d, A.phone).locator('.pp-field__error')).toHaveCount(0);
    expect(posts(fx)).toEqual([]);
  });

  // Lock check F6: a phone problem takes its place after the fields above it.
  test('AC-6 An empty first name and a wrong phone are listed in the order of the fields: First name, then Phone', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    await fill(d, { ...GOOD, first: '', phone: '082 ABC 0000' });
    await createButton(d).click();
    await errorUnder(d, A.first, A.firstEmpty);
    await errorUnder(d, A.phone, A.phoneWrong);
    await summaryIs(page, d, [[A.first, A.firstEmpty], [A.phone, A.phoneWrong]]);
    await quiet(page);
    expect(posts(fx)).toEqual([]);
  });

  test('AC-6 The names take at most 80 characters and the email at most 254 (the field takes no more)', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    await expect(field(d, A.first)).toHaveAttribute('maxlength', '80');
    await expect(field(d, A.last)).toHaveAttribute('maxlength', '80');
    await expect(field(d, A.email)).toHaveAttribute('maxlength', '254');
    await field(d, A.first).click();
    await page.keyboard.type('N'.repeat(90));
    expect((await field(d, A.first).inputValue()).length).toBe(80);
  });
});

// ================================================================ AC-7 The body (rule 5, rule 10)
test.describe('AC-7 The body', () => {
  test.beforeEach(noBackendOnly);

  test('AC-7 A filled form sends one POST /v1/candidates with exactly first_name, last_name, email and role_id, trimmed, the chosen role\'s id, and one Idempotency-Key', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    await fill(d, { first: '  Nandi ', last: ' Khumalo  ', email: ' nandi.khumalo@example.org ', role: 'Warehouse supervisor' });
    await createButton(d).click();
    await expect.poll(() => posts(fx).length).toBe(1);
    await quiet(page);
    expect(posts(fx).length, 'one request').toBe(1);
    expect(body(fx), 'exactly the four keys, trimmed').toEqual({ first_name: 'Nandi', last_name: 'Khumalo', email: 'nandi.khumalo@example.org', role_id: 'role-warehouse' });
    const key = posts(fx)[0]!.idempotencyKey;
    expect(key, 'an Idempotency-Key header').toBeTruthy();
    expect(key!.length, 'a key of 16 to 128 characters (cards/rec-ui-02.1.md T-3)').toBeGreaterThanOrEqual(16);
    expect(key!.length).toBeLessThanOrEqual(128);
    for (const part of ['nandi', 'khumalo', 'role-warehouse', 'thandi', 'tnt-']) expect(key!.toLowerCase(), `the key carries no person, role or company (${part})`).not.toContain(part);
    expect(companyIdIn(posts(fx)[0]!), 'no company in the request').toEqual([]);
  });

  // Lock check F6: values are trimmed only, never changed: an email in mixed case is sent as typed.
  test('AC-7 An email typed in mixed case is sent as typed (trimmed, not lowercased)', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'board');
    await fill(d, { first: GOOD.first, last: GOOD.last, email: ' Nandi.Khumalo@Example.ORG ' });
    await createButton(d).click();
    await expect.poll(() => posts(fx).length).toBe(1);
    expect(body(fx)['email']).toBe('Nandi.Khumalo@Example.ORG');
  });

  const WITH: Array<[string, Parameters<typeof fill>[1], Record<string, string>]> = [
    ['a phone and LinkedIn', { phone: '  082 555 0101 ', source: 'LinkedIn' }, { phone: '082 555 0101', source: 'LinkedIn' }],
    ['a +27 phone and Referral', { phone: '+27 82 555 0101', source: 'Referral' }, { phone: '+27 82 555 0101', source: 'Referral' }],
    ['a phone only', { phone: '0825550101' }, { phone: '0825550101' }],
    // Lock check F4: the limits themselves are accepted.
    ['a phone of exactly 9 digits', { phone: '082 555 010' }, { phone: '082 555 010' }],
    ['a phone of exactly 15 digits', { phone: '+27 82 555 0101 1234' }, { phone: '+27 82 555 0101 1234' }],
    ['a source only', { source: 'Referral' }, { source: 'Referral' }],
  ];
  for (const [label, extra, sent] of WITH) {
    test(`AC-7 With ${label} the body adds exactly ${Object.keys(sent).join(' and ')}`, async ({ page, signIn, cognito, modules, hire, add }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, add };
      await enterAs(fx);
      const d = await openFrom(fx, 'board');
      await fill(d, { first: GOOD.first, last: GOOD.last, email: GOOD.email, ...extra });
      await createButton(d).click();
      await expect.poll(() => posts(fx).length).toBe(1);
      expect(body(fx)).toEqual({ first_name: GOOD.first, last_name: GOOD.last, email: GOOD.email, role_id: 'role-fleet', ...sent });
    });
  }

  test('AC-7 A phone typed and cleared, and a source chosen and put back to nothing, are not sent', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'board');
    await fill(d, { first: GOOD.first, last: GOOD.last, email: GOOD.email, phone: '082 555 0101', source: 'LinkedIn' });
    await field(d, A.phone).fill('   ');
    await field(d, A.source).selectOption({ index: 0 }).catch(async () => choose(d, A.source, ''));
    await createButton(d).click();
    await expect.poll(() => posts(fx).length).toBe(1);
    expect(Object.keys(body(fx)).sort(), 'only the four keys').toEqual(KEYS);
  });

  // REC-15 rule 19 refuses each of these; the page never sends one (the role decides title, level, department, manager and company).
  const REFUSED = ['title', 'job_title', 'positionTitle', 'position_title', 'level', 'positionLevel', 'department', 'department_id', 'hiring_manager', 'hiring_manager_id', 'hiringManagerId',
    'company', 'company_id', 'companyId', 'tenant_id', 'tenantId', 'cv', 'cv_key', 'cvKey', 'idempotencyKey', 'location', 'name', 'stage'];
  test(`AC-7 The body never carries a refused key (${REFUSED.length} named), on the board, the Pipeline list and Candidates`, async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    for (const [i, where] of (['board', 'list', 'candidates'] as const).entries()) {
      const d = await openFrom(fx, where);
      await fill(d, { first: `Nandi${'abc'[i]}`, last: GOOD.last, email: `n${i}@example.org`, role: 'Senior accountant', phone: '082 555 0101', source: 'Referral' });
      await createButton(d).click();
      await expect.poll(() => posts(fx).length).toBe(i + 1);
      await expect(drawer(page)).toHaveCount(0);
    }
    for (const c of posts(fx)) {
      for (const k of REFUSED) expect(Object.keys(c.body as object), `never "${k}"`).not.toContain(k);
      expect(Object.keys(c.body as object).sort()).toEqual([...KEYS, 'phone', 'source'].sort());
    }
  });
});

// ================================================================ AC-8 One send (rule 5, follow-ups 1 and 2 of PR 506)
test.describe('AC-8 One send', () => {
  test.beforeEach(noBackendOnly);

  test('AC-8 A double click sends one request, and Create candidate is disabled while it runs', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    await fill(d, GOOD);
    add!.refuse({ hold: true });
    await createButton(d).dblclick();
    await expect.poll(() => add!.heldCount).toBe(1);
    await expect(createButton(d), 'disabled while the request runs').toBeDisabled();
    await createButton(d).click({ force: true }).catch(() => undefined);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    add!.release();
    await expect(drawer(page)).toHaveCount(0);
    await quiet(page);
    expect(posts(fx).length, 'one request for a double click').toBe(1);
    expect(add!.made.length, 'one candidate').toBe(1);
  });

  for (const [label, how] of [['a 500', { status: 500, body: { error: 'Something went wrong' } }], ['a dropped connection', { abort: true }]] as const) {
    test(`AC-8 After ${label}, pressing again sends the same Idempotency-Key and the same body`, async ({ page, signIn, cognito, modules, hire, add }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, add };
      await enterAs(fx);
      const d = await openFrom(fx, 'candidates');
      await fill(d, { ...GOOD, phone: '082 555 0101' });
      add!.refuse(how);
      await createButton(d).click();
      await expect(d.getByText(A.saveFail, { exact: true })).toBeVisible();
      await createButton(d).click();
      await expect(drawer(page)).toHaveCount(0);
      expect(posts(fx).length).toBe(2);
      expect(posts(fx)[1]!.idempotencyKey, 'the same key on the retry').toBe(posts(fx)[0]!.idempotencyKey);
      expect(posts(fx)[1]!.body).toEqual(posts(fx)[0]!.body);
      expect(add!.made.length).toBe(1);
    });
  }

  test('AC-8 Closing the drawer and opening it again makes a new key; so does the next candidate after a success', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    let d = await openFrom(fx, 'candidates');
    await fill(d, GOOD);
    add!.refuse({ status: 500, body: { error: 'Something went wrong' } });
    await createButton(d).click();
    await expect(d.getByText(A.saveFail, { exact: true })).toBeVisible();
    await cancelButton(d).click();
    await expect(drawer(page)).toHaveCount(0);
    d = await openDrawer(page);
    await fill(d, GOOD);
    await createButton(d).click();
    await expect(drawer(page)).toHaveCount(0);
    d = await openDrawer(page);
    for (const l of [A.first, A.last, A.email]) await expect(field(d, l), 'after a success the drawer opens empty').toHaveValue('');
    await expect(d.getByText(/gets an email saying/)).toHaveCount(0);
    await fill(d, { ...GOOD, first: 'Sibongile', email: 'sibongile@example.org' });
    await createButton(d).click();
    await expect(drawer(page)).toHaveCount(0);
    const keys = posts(fx).map((c) => c.idempotencyKey);
    expect(keys.length).toBe(3);
    expect(new Set(keys).size, 'a new key for each opening').toBe(3);
    expect(add!.made.map((c) => c.name)).toEqual(['Nandi Khumalo', 'Sibongile Khumalo']);
  });
});

// ================================================================ AC-9 Success (rule 7)
test.describe('AC-9 Success', () => {
  test.beforeEach(noBackendOnly);

  test('AC-9 On the board a 201 closes the drawer, puts focus on Add candidate, reads the board again, and shows the new candidate in Applied with the counts one higher', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    await openPage(page, 'board');
    await expect(main(page).getByText('6 candidates · Hiring manager Sipho Ndlovu', { exact: true })).toBeVisible();
    expect((await boardNow(page))['Applied']).toEqual(['Amahle Dlamini']);
    const d = await openDrawer(page);
    await fill(d, { first: 'Nandi', last: 'Khumalo', email: 'nandi.khumalo@example.org' });
    const reads = listReads(fx).length;
    await createButton(d).click();
    await closedWithFocusBack(page);
    expect(posts(fx)[0]!.status).toBe(201);
    await expect.poll(() => listReads(fx).length, 'the board reads its list again').toBeGreaterThan(reads);
    expect(listReads(fx).at(-1)!.query['role_id'], 'for its own role').toBe('role-fleet');
    await expect(main(page).getByText('7 candidates · Hiring manager Sipho Ndlovu', { exact: true })).toBeVisible();
    await expect(main(page).getByRole('tab', { name: /^All\s*7$/ })).toBeVisible();
    await expect.poll(async () => ((await boardNow(page))['Applied'] ?? []).slice().sort()).toEqual(['Amahle Dlamini', 'Nandi Khumalo']);
    // No new confirmation words (D-RUI-5).
    expect(await main(page).innerText()).not.toMatch(/\b(added|created|success)\b/i);
    await expect(page.locator('.pp-section-message--success, .pp-flag, [role="status"]:has-text("Nandi")')).toHaveCount(0);
  });

  test('AC-9 On Candidates a 201 closes the drawer, the list is read again, the new candidate is a row with "Applied" and All goes up by one', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    await expect(main(page).getByRole('tab', { name: /^All\s*13$/ })).toBeVisible();
    await fill(d, GOOD);
    await createButton(d).click();
    await closedWithFocusBack(page);
    await expect(main(page).getByRole('tab', { name: /^All\s*14$/ })).toBeVisible();
    await expect.poll(async () => (await readRows(page)).find((r) => r.name === 'Nandi Khumalo')?.stage).toBe('Applied');
    expect((await readRows(page)).find((r) => r.name === 'Nandi Khumalo')!.meta).toBe('Warehouse supervisor · Senior');
  });

  test('AC-9 The list is read again with its current filters: on the Overdue tab the read keeps sla_status and the counts still go up', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    await openPage(page, 'candidates');
    await main(page).getByRole('tab', { name: /^Overdue\s*\d+$/ }).click();
    await quiet(page);
    const d = await openDrawer(page);
    await fill(d, GOOD);
    const reads = listReads(fx).length;
    await createButton(d).click();
    await closedWithFocusBack(page);
    await expect.poll(() => listReads(fx).length).toBeGreaterThan(reads);
    expect(listReads(fx).at(-1)!.query['sla_status'], 'the same tab').toBe('OVERDUE');
    await expect(main(page).getByRole('tab', { name: /^All\s*14$/ })).toBeVisible();
    await expect(main(page).getByRole('tab', { name: /^Overdue\s*\d+$/ })).toHaveAttribute('aria-selected', 'true');
    expect((await readRows(page)).map((r) => r.name)).toEqual(['Bongani Mthembu']);
  });

  test('AC-9 On the Pipeline list of Warehouse supervisor a 201 reads that role\'s list again and shows the row; "{n} candidates" goes from 4 to 5', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'list', '/hire/pipeline?role=role-warehouse&view=list', 'Pipeline');
    await expect(main(page).getByText('4 candidates', { exact: true })).toBeVisible();
    await fill(d, { first: 'Nandi', last: 'Khumalo', email: 'nandi.khumalo@example.org' });
    await createButton(d).click();
    await closedWithFocusBack(page);
    await expect(main(page).getByText('5 candidates', { exact: true })).toBeVisible();
    expect(listReads(fx).at(-1)!.query['role_id']).toBe('role-warehouse');
    await expect.poll(async () => (await readRows(page)).find((r) => r.name === 'Nandi Khumalo')?.stage).toBe('Applied');
  });

  test('AC-9 A replay\'s 200: the server stored the candidate but the answer was lost; pressing again sends the same key, gets the same body with 200, and the drawer closes with the candidate shown once', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    await fill(d, GOOD);
    add!.refuse({ storeThenDrop: true });
    await createButton(d).click();
    await expect(d.getByText(A.saveFail, { exact: true })).toBeVisible();
    await createButton(d).click();
    await closedWithFocusBack(page);
    expect(posts(fx).map((c) => c.status)).toEqual([-1, 200]);
    expect(posts(fx)[1]!.idempotencyKey).toBe(posts(fx)[0]!.idempotencyKey);
    await expect(main(page).getByRole('tab', { name: /^All\s*14$/ })).toBeVisible();
    await expect.poll(async () => (await readRows(page)).filter((r) => r.name === 'Nandi Khumalo').length, 'shown once').toBe(1);
    expect(add!.made.length, 'stored once').toBe(1);
  });
});

// ================================================================ AC-10 Refusals (rule 7)
test.describe('AC-10 Refusals', () => {
  test.beforeEach(noBackendOnly);
  const FULL = { ...GOOD, phone: '082 555 0101', source: 'LinkedIn' };

  test('AC-10 409 ROLE_CLOSED keeps everything typed, shows "This role is closed. Choose another role." on the Role field, and reads the roles again: the closed role is gone', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    await fill(d, FULL);
    // Someone else closes Warehouse supervisor while the drawer is open: the real server answers 409 ROLE_CLOSED.
    hire!.world.roles.find((r) => r.role_id === 'role-warehouse')!.status = 'CLOSED';
    const reads = roleReads(fx).length;
    await createButton(d).click();
    await expect.poll(() => posts(fx).at(-1)?.status).toBe(409);
    await errorUnder(d, A.role, A.roleClosed);
    await kept(d, { first: FULL.first, last: FULL.last, email: FULL.email, phone: FULL.phone, source: FULL.source });
    await expect.poll(() => roleReads(fx).length, 'the role choices are read again').toBeGreaterThan(reads);
    await expect.poll(async () => (await optionsOf(d, A.role)).includes('Warehouse supervisor'), 'the closed role is gone').toBe(false);
    expect(await d.innerText()).not.toMatch(NEVER_SHOWN);
    // Choosing another role and pressing again adds the candidate.
    await choose(d, A.role, 'Fleet controller');
    await createButton(d).click();
    await expect(drawer(page)).toHaveCount(0);
    expect(add!.made.map((c) => c.role_id)).toEqual(['role-fleet']);
  });

  test('AC-10 404 shows "This role could not be found." at the top of the drawer, keeps everything typed and reads the roles again', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    await fill(d, FULL);
    hire!.world.roles = hire!.world.roles.filter((r) => r.role_id !== 'role-warehouse');
    const reads = roleReads(fx).length;
    await createButton(d).click();
    await expect.poll(() => posts(fx).at(-1)?.status).toBe(404);
    const msg = d.locator('.pp-section-message--danger').filter({ hasText: A.roleNotFound });
    await expect(msg).toBeVisible();
    const top = (await msg.boundingBox())!, first = (await field(d, A.first).boundingBox())!;
    expect(top.y, 'at the top, above the fields').toBeLessThan(first.y);
    await kept(d, { first: FULL.first, last: FULL.last, email: FULL.email, phone: FULL.phone, source: FULL.source });
    await expect.poll(() => roleReads(fx).length).toBeGreaterThan(reads);
    await expect.poll(async () => (await optionsOf(d, A.role)).includes('Warehouse supervisor')).toBe(false);
    expect(await d.innerText()).not.toMatch(NEVER_SHOWN);
  });

  const FAILS: Array<[string, { status?: number; body?: unknown; abort?: boolean }]> = [
    ['a 400 INVALID_FIELD', { status: 400, body: { error: 'Bad request', code: 'INVALID_FIELD', field: 'email' } }],
    ['a 400 ROLE_REQUIRED', { status: 400, body: { error: 'Bad request', code: 'ROLE_REQUIRED' } }],
    ['a 403', { status: 403, body: { error: 'Forbidden' } }],
    ['a 409 IN_PROGRESS', { status: 409, body: { error: 'Conflict', code: 'IN_PROGRESS' } }],
    ['a 500', { status: 500, body: { error: 'Something went wrong' } }],
    ['a dropped connection', { abort: true }],
  ];
  for (const [label, how] of FAILS) {
    test(`AC-10 ${label} shows "${A.saveFail}" and keeps every typed value; no code, status or server words`, async ({ page, signIn, cognito, modules, hire, add }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, add };
      await enterAs(fx);
      const d = await openFrom(fx, 'board');
      await fill(d, FULL);
      add!.refuse(how);
      await createButton(d).click();
      const msg = d.locator('.pp-section-message--danger').filter({ hasText: A.saveFail });
      await expect(msg).toBeVisible();
      await expect(d).toBeVisible();
      await kept(d, { first: FULL.first, last: FULL.last, email: FULL.email, phone: FULL.phone, source: FULL.source });
      expect(await chosen(d, A.role)).toBe('Warehouse supervisor');
      expect(await d.innerText()).not.toMatch(NEVER_SHOWN);
      await expect(d.getByText(A.roleNotFound)).toHaveCount(0);
      await expect(d.getByText(A.roleClosed)).toHaveCount(0);
      await expect(createButton(d), 'Create candidate can be pressed again').toBeEnabled();
      // Lock check F2: pressing again after any of these sends the same Idempotency-Key and body, so a first request the
      // server is still working on (409 IN_PROGRESS) and the retry can never make two candidates.
      await createButton(d).click();
      await expect(drawer(page)).toHaveCount(0);
      expect(posts(fx).length).toBe(2);
      expect(posts(fx)[1]!.idempotencyKey, 'the same key on the retry').toBe(posts(fx)[0]!.idempotencyKey);
      expect(posts(fx)[1]!.body).toEqual(posts(fx)[0]!.body);
      expect(add!.made.length, 'one candidate').toBe(1);
    });
  }
});

// ================================================================ AC-11 Role choices fail or are empty (rule 7)
test.describe('AC-11 Role choices fail or are empty', () => {
  test.beforeEach(noBackendOnly);

  for (const [label, how] of [['a 500', { status: 500 }], ['a dropped connection', { abort: true }]] as const) {
    test(`AC-11 With ${label} on the roles read, the Role field shows "${A.rolesFail}" with Try again, Create candidate stays disabled, and Try again reads them again`, async ({ page, signIn, cognito, modules, hire, add }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, add };
      await enterAs(fx);
      await openPage(page, 'board');
      hire!.refuse({ method: 'GET', path: /\/v1\/roles$/, ...how, once: false });
      const d = await openDrawer(page);
      await fill(d, { first: GOOD.first, last: GOOD.last, email: GOOD.email });
      const box = fieldBox(d, A.role);
      await expect(d.getByText(A.rolesFail, { exact: true })).toBeVisible();
      const again = d.getByRole('button', { name: A.tryAgain, exact: true });
      await expect(again).toBeVisible();
      await expect(createButton(d)).toBeDisabled();
      expect(await box.count(), 'the Role field is still there').toBeGreaterThan(0);
      hire!.lift();
      const reads = roleReads(fx).length;
      await again.click();
      await expect.poll(() => roleReads(fx).length, 'Try again reads them again').toBe(reads + 1);
      await expect.poll(async () => (await optionsOf(d, A.role)).slice(1)).toEqual(A_ROLE_TITLES);
      await expect(d.getByText(A.rolesFail, { exact: true })).toHaveCount(0);
      await choose(d, A.role, 'Fleet controller');
      await expect(createButton(d)).toBeEnabled();
      await createButton(d).click();
      await expect(drawer(page)).toHaveCount(0);
      expect(posts(fx).length).toBe(1);
    });
  }

  test(`AC-11 With no open roles the Role field reads "${A.noRoles}" and Create candidate stays disabled`, async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    for (const r of hire!.world.roles) if (r.company === 'A') r.status = 'CLOSED';
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    await fill(d, { first: GOOD.first, last: GOOD.last, email: GOOD.email });
    await expect(fieldBox(d, A.role).getByText(A.noRoles, { exact: true })).toBeVisible();
    await expect(createButton(d)).toBeDisabled();
    await createButton(d).click({ force: true }).catch(() => undefined);
    await quiet(page);
    expect(posts(fx)).toEqual([]);
  });
});

// ================================================================ AC-12 Cancel and close (rule 8)
test.describe('AC-12 Cancel', () => {
  test.beforeEach(noBackendOnly);

  for (const how of ['Cancel', 'Close', 'Escape'] as const) {
    test(`AC-12 ${how} sends nothing, asks nothing, closes the drawer and returns focus to Add candidate; opening again shows empty fields and the starting role`, async ({ page, signIn, cognito, modules, hire, add }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, add };
      await enterAs(fx);
      const d = await openFrom(fx, 'list', '/hire/pipeline?role=role-warehouse&view=list', 'Pipeline');
      await fill(d, { first: 'Nandi', last: 'Khumalo', email: 'nandi@example.org', role: 'Fleet controller', phone: '082 555 0101', source: 'LinkedIn' });
      if (how === 'Cancel') await cancelButton(d).click();
      else if (how === 'Close') await closeButton(d).click();
      else await page.keyboard.press('Escape');
      await closedWithFocusBack(page);
      await expect(page.getByRole('dialog'), 'nothing asks first').toHaveCount(0);
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await quiet(page);
      expect(posts(fx)).toEqual([]);
      const again = await openDrawer(page);
      for (const l of [A.first, A.last, A.email]) await expect(field(again, l)).toHaveValue('');
      await expect.poll(() => chosen(again, A.role)).toBe('Warehouse supervisor');
      await openMore(again);
      await expect(field(again, A.phone)).toHaveValue('');
      await expect.poll(() => chosen(again, A.source), 'Source is empty again').toBe('');
      await expect(again.getByText(/gets an email saying/)).toHaveCount(0);
      await expect(again.locator('.pp-form-error-summary, .pp-field__error')).toHaveCount(0);
    });
  }

  test('AC-12 After a refusal, Cancel and opening again shows no old error', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    await createButton(d).click();
    await expect(d.locator('.pp-form-error-summary')).toBeVisible();
    await fill(d, GOOD);
    add!.refuse({ status: 500, body: { error: 'Something went wrong' } });
    await createButton(d).click();
    await expect(d.getByText(A.saveFail, { exact: true })).toBeVisible();
    await cancelButton(d).click();
    const again = await openDrawer(page);
    await expect(again.getByText(A.saveFail)).toHaveCount(0);
    await expect(again.locator('.pp-form-error-summary, .pp-field__error, .pp-section-message--danger')).toHaveCount(0);
  });
});

// ================================================================ AC-13 Company B and C (rule 10, tenancy)
test.describe('AC-13 Company B and C', () => {
  test.beforeEach(noBackendOnly);

  /** Company B with Recruitment on, a second open role and a closed one. */
  function companyB(fx: Fx): void {
    recruitmentOn(fx.modules!.answers, 'B');
    const base = fx.hire!.world.roles.find((r) => r.role_id === 'role-b-dispatch')!;
    fx.hire!.world.roles.push({ ...base, role_id: 'role-b-night', job_title: 'Night dispatcher' }, { ...base, role_id: 'role-b-stores', job_title: 'Stores clerk', status: 'CLOSED' });
  }

  test('AC-13 A Recruiter of B is offered only B\'s open roles, adds a candidate with no company anywhere in the request, and sees it on B\'s list', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    companyB(fx);
    await enterAs(fx, WHO.recruiterB);
    const d = await openFrom(fx, 'candidates');
    expect(await optionsOf(d, A.role)).toEqual([A.choose, 'Dispatch lead', 'Night dispatcher']);
    const text = await d.innerText();
    for (const other of [...A_ROLE_TITLES, 'Head baker', 'Stores clerk']) expect(text, `never "${other}"`).not.toContain(other);
    await fill(d, { first: 'Lindani', last: 'Ngcobo', email: 'lindani@example.org', role: 'Night dispatcher', phone: '082 555 0101', source: 'Referral' });
    await createButton(d).click();
    await expect(drawer(page)).toHaveCount(0);
    expect(posts(fx)[0]!.company, 'the server took the company from the sign-in').toBe('B');
    expect(body(fx)['role_id']).toBe('role-b-night');
    await expect.poll(async () => (await readRows(page)).map((r) => r.name)).toContain('Lindani Ngcobo');
    for (const call of hire!.calls.filter((c) => c.method !== 'OPTIONS')) expect(companyIdIn(call), `${call.method} ${call.path}`).toEqual([]);
  });

  test('AC-13 A role id the server says is company A\'s answers 404 to B: the drawer shows "This role could not be found.", never A\'s role, and B\'s choices are read again', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    companyB(fx);
    await enterAs(fx, WHO.recruiterB);
    const d = await openFrom(fx, 'list');
    await fill(d, { first: 'Lindani', last: 'Ngcobo', email: 'lindani@example.org', role: 'Dispatch lead' });
    // The role now belongs to company A in the server's eyes.
    hire!.world.roles.find((r) => r.role_id === 'role-b-dispatch')!.company = 'A';
    await createButton(d).click();
    await expect.poll(() => posts(fx).at(-1)?.status).toBe(404);
    await expect(d.getByText(A.roleNotFound, { exact: true })).toBeVisible();
    await expect.poll(async () => optionsOf(d, A.role)).toEqual([A.choose, 'Night dispatcher']);
    const text = await d.innerText();
    for (const other of [...A_ROLE_TITLES, 'Dispatch lead']) expect(text, `no role of company A ("${other}")`).not.toContain(other);
    expect(await main(page).innerText()).not.toMatch(/Fleet controller|Warehouse supervisor|Senior accountant|Amahle Dlamini/);
    expect(add!.made).toEqual([]);
  });

  // Lock check F1 (safety): the app's sign-out does not reload the page, so role choices kept in memory or in the browser's
  // storage would survive it and be offered to the next person. A signs out, B signs in on the same browser, and B's drawer
  // offers only B's open roles and never shows an A title, not even for a moment. Once with no page load, once with one.
  for (const reload of [false, true]) {
    test(`AC-13 After a Recruiter of A used the drawer and signed out, a Recruiter of B on the same browser${reload ? ' (after a page load)' : ''} is offered only B's open roles and never sees one of A's`, async ({ page, signIn, cognito, modules, hire, add }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, add };
      companyB(fx);
      await enterAs(fx);
      let d = await openFrom(fx, 'candidates');
      expect((await optionsOf(d, A.role)).slice(1), 'A first sees A\'s open roles').toEqual(['Fleet controller', 'Warehouse supervisor', 'Senior accountant']);
      await choose(d, A.role, 'Fleet controller');
      await cancelButton(d).click();
      await expect(drawer(page)).toHaveCount(0);
      await avatarButton(page).click();
      await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
      await expect(page).toHaveURL(/\/sign-in/);
      if (reload) await page.reload();
      const loads: string[] = [];
      page.on('load', () => loads.push(page.url()));
      meet(fx.hire, WHO.recruiterB);
      if (cognito && cognito.subOf(WHO.recruiterB.email) === undefined) cognito.addAccount(WHO.recruiterB);
      modules!.assign(WHO.recruiterB.email, WHO.recruiterB.company);
      hire!.assign(WHO.recruiterB);
      await signIn.signInAs(WHO.recruiterB);
      await expect(page).toHaveURL(WHO.recruiterB.lands!);
      // Watch every change of the page from now on: an A title shown even for a moment is caught.
      await page.evaluate((secret) => {
        const seen: string[] = [];
        (window as unknown as { __seenA: string[] }).__seenA = seen;
        const look = () => { const t = document.body.innerText + ' ' + Array.from(document.querySelectorAll('option')).map((o) => o.textContent).join(' '); for (const n of secret) if (t.includes(n) && !seen.includes(n)) seen.push(n); };
        look();
        new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      }, A_ROLE_TITLES);
      await openNav(page);
      await navItems(page).filter({ hasText: /^Candidates$/ }).click();
      await expect(page).toHaveURL(/\/hire\/candidates$/);
      await quiet(page);
      d = await openDrawer(page);
      await expect.poll(async () => optionsOf(d, A.role), 'only B\'s open roles').toEqual([A.choose, 'Dispatch lead', 'Night dispatcher']);
      expect(await chosen(d, A.role), 'nothing of A\'s is chosen').toBe(A.choose);
      await quiet(page);
      expect(await page.evaluate(() => (window as unknown as { __seenA: string[] }).__seenA), 'no role title of company A was ever on the page after B signed in').toEqual([]);
      if (!reload) expect(loads, 'no full page load after sign-out (the memory of the tab was kept)').toEqual([]);
      expect(roleReads(fx).filter((c) => c.company === 'B').length, 'B\'s roles were read for B').toBeGreaterThanOrEqual(1);
    });
  }

  test('AC-13 A Recruiter of company C (Recruitment off) never sees Add candidate and sends nothing', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await seenByRecruiterFirst(fx);
    await enterAs(fx, WHO.recruiterC);
    for (const where of ['board', 'list', 'candidates'] as const) {
      await page.goto(PAGES[where].url);
      await quiet(page);
      await expect(page.getByRole('button', { name: A.button })).toHaveCount(0);
      await expect(drawer(page)).toHaveCount(0);
    }
    expect(posts(fx)).toEqual([]);
  });
});

// ================================================================ AC-14 Who sees it (existing guard)
test.describe('AC-14 Who sees it', () => {
  test.beforeEach(noBackendOnly);

  const OTHERS: Array<[string, Who]> = [['HR without the Recruitment tick', WHO.hrNoTickA], ['a hiring manager', WHO.managerA], ['an Employee', WHO.employeeA], ['the tick without HR', WHO.tickOnlyA], ['an Admin', WHO.adminA]];
  for (const [label, who] of OTHERS) {
    test(`AC-14 ${label} never reaches a page with Add candidate and sends nothing`, async ({ page, signIn, cognito, modules, hire, add }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, add };
      await seenByRecruiterFirst(fx);
      meet(hire, who);
      await signInAs(signIn, cognito, modules, hire, who);
      if (who.lands) await expect(page).toHaveURL(who.lands);
      else await expect(page).toHaveURL(/\/sign-in/);
      for (const where of ['board', 'list', 'candidates'] as const) {
        await page.goto(PAGES[where].url);
        await quiet(page);
        await expect(page, 'sent away from the page').not.toHaveURL(/\/hire\//);
        await expect(page.getByRole('button', { name: A.button })).toHaveCount(0);
      }
      expect(posts(fx)).toEqual([]);
    });
  }
});

// ================================================================ AC-15 Look and alignment (section 5)
test.describe('AC-15 Look and alignment', () => {
  test.beforeEach(noBackendOnly);

  type Box = { x: number; y: number; w: number; h: number };
  const boxOf = async (l: Locator): Promise<Box> => { const b = (await l.boundingBox())!; return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  /** The box a person sees for a field's control: a picker's native <select> sits inside the design system's .pp-select box
   *  (components.css: ".pp-select is the box"), so a picker is measured by that box, a text field by the input itself. */
  const controlOf = async (l: Locator): Promise<Box> => {
    const b = await l.evaluate((el) => { const box = el.closest('.pp-select') ?? el; const r = box.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    return b;
  };

  /** The drawer with More details open, every field shown, and (when asked) the error summary up. */
  async function ready(fx: Fx, errors: boolean): Promise<Locator> {
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    await openMore(d);
    if (errors) { await createButton(d).click(); await expect(d.locator('.pp-form-error-summary')).toBeVisible(); }
    await field(d, A.first).fill('Amahle');
    await expect(d.locator('.pp-inline-message')).toBeVisible();
    return d;
  }

  const LABELS = [A.first, A.last, A.email, A.role, A.phone, A.source];

  test('AC-15 A-1, A-2, A-3, A-4: every label sits above its control at the same left edge; the form\'s labels, controls, More details, the notice and the summary share one left edge (Phone and Source share the More details panel\'s edge); fields and pickers fill their width at one width and one height (40 px desktop, 48 px phone), none small', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    const d = await ready(fx, true);
    // The design system pads the accordion's panel (components.css .pp-accordion__panel), as the kit draws it: the two fields
    // inside "More details" are measured against the panel's content box, every other part against the form (cards T-2).
    const panel = await d.locator('.pp-accordion__panel').first().evaluate((el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { left: r.left + parseFloat(s.paddingLeft), width: r.width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) }; });
    const form = await boxOf(fieldBox(d, A.first));
    const inPanel = (l: string) => l === A.phone || l === A.source;
    const heights: Array<[string, number]> = [];
    for (const l of LABELS) {
      const c = await controlOf(field(d, l));
      const lab = await boxOf(fieldBox(d, l).locator('.pp-field__label').first());
      expect(lab.y + lab.h, `A-1 the ${l} label is above its control`).toBeLessThanOrEqual(c.y + 1);
      expect(Math.abs(lab.x - c.x), `A-1 the ${l} label starts at the control's left edge`).toBeLessThanOrEqual(1);
      const edge = inPanel(l) ? panel.left : form.x, width = inPanel(l) ? panel.width : form.w;
      expect(Math.abs(c.x - edge), `A-2 the ${l} control is on ${inPanel(l) ? 'the panel\'s' : 'the form\'s'} left edge`).toBeLessThanOrEqual(1);
      expect(Math.abs(c.w - width), `A-3 the ${l} control fills ${inPanel(l) ? 'the panel' : 'the form'}`).toBeLessThanOrEqual(1);
      heights.push([l, c.h]);
    }
    const phoneW = (await controlOf(field(d, A.phone))).w, sourceW = (await controlOf(field(d, A.source))).w;
    expect(Math.abs(phoneW - sourceW), 'A-3 Phone and Source have one width').toBeLessThanOrEqual(1);
    for (const l of [A.first, A.last, A.email]) expect(Math.abs((await controlOf(field(d, l))).w - (await controlOf(field(d, A.role))).w), `A-3 ${l} and Role have one width`).toBeLessThanOrEqual(1);
    for (const [what, loc] of [['More details', d.locator('.pp-accordion').first()], ['the notice', d.locator('.pp-inline-message')], ['the summary', d.locator('.pp-form-error-summary')]] as const) {
      expect(Math.abs((await boxOf(loc)).x - form.x), `A-2 ${what} is on the form's left edge`).toBeLessThanOrEqual(1);
    }
    const want = phone() ? 48 : 40;
    for (const [l, h] of heights) expect(Math.round(h), `A-4 ${l} is ${want} px high`).toBe(want);
    await expect(d.locator('.pp-text-field--small, .pp-select--small, .pp-select--fit, .pp-button--small'), 'A-4 nothing small, nothing fit').toHaveCount(0);
  });

  test('AC-15 A-5 Footer: desktop, two buttons on one line at the right with Create candidate last; phone, full width, stacked, Create candidate first, each at least 48 px', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    const d = await ready(fx, false);
    const cancel = await boxOf(cancelButton(d)), create = await boxOf(createButton(d));
    const foot = await boxOf(d.locator('.pp-drawer__footer'));
    const inner = await d.locator('.pp-drawer__footer').evaluate((el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return { left: r.left + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.paddingRight) }; });
    expect(foot.h).toBeGreaterThan(0);
    if (!phone()) {
      expect(Math.abs(cancel.y - create.y), 'one top').toBeLessThanOrEqual(1);
      expect(Math.abs(cancel.h - create.h), 'one height').toBeLessThanOrEqual(1);
      expect(create.x, 'Create candidate last').toBeGreaterThan(cancel.x);
      expect(Math.abs(create.x + create.w - inner.right), 'at the right').toBeLessThanOrEqual(1);
    } else {
      expect(create.y + create.h, 'Create candidate on top').toBeLessThanOrEqual(cancel.y + 1);
      for (const [n, b] of [['Create candidate', create], ['Cancel', cancel]] as const) {
        expect(b.h, `${n} at least 48 px`).toBeGreaterThanOrEqual(48);
        expect(Math.abs(b.w - (inner.right - inner.left)), `${n} full width`).toBeLessThanOrEqual(1);
      }
    }
  });

  for (const where of ['board', 'list', 'candidates'] as const) {
    test(`AC-15 A-6 On ${where === 'board' ? 'the board' : where === 'list' ? 'the Pipeline list' : 'Candidates'} the header button is a direct part of the header actions; desktop: the height and vertical centre of the List / Board switch; phone: at least 48 px, on the screen`, async ({ page, signIn, cognito, modules, hire, add }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, add };
      await enterAs(fx);
      await openPage(page, where);
      // The kit puts the button straight in the actions; the design system's phone rule (components.css, .pp-page-header__actions >
      // .pp-button--primary: 48 px, grows to fill) only reaches it there (cards T-2).
      expect(await addButton(page).evaluate((b) => !!b.parentElement?.classList.contains('pp-page-header__actions')), 'a direct child of .pp-page-header__actions').toBe(true);
      const btn = await boxOf(addButton(page));
      if (phone()) {
        expect(btn.h, 'the design system\'s large control on phone').toBeGreaterThanOrEqual(48);
        expect(btn.x, 'on the screen').toBeGreaterThanOrEqual(0);
        expect(btn.x + btn.w).toBeLessThanOrEqual(page.viewportSize()!.width);
        return;
      }
      if (where === 'candidates') return;
      const s = await boxOf(main(page).locator('.pp-page-header__actions').first().getByRole('button', { name: where === 'board' ? 'Board' : 'List', exact: true }));
      expect(Math.abs(btn.h - s.h), 'the same height').toBeLessThanOrEqual(1);
      expect(Math.abs(btn.y + btn.h / 2 - (s.y + s.h / 2)), 'the same vertical centre').toBeLessThanOrEqual(1);
    });
  }

  test('AC-15 A-7 "(optional)" sits inside the label, on the label\'s line, in the design system\'s pp-field__optional style', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    const d = await ready(fx, false);
    for (const l of [A.phone, A.source]) {
      const lab = fieldBox(d, l).locator('.pp-field__label').first();
      const opt = lab.locator('.pp-field__optional');
      await expect(opt).toHaveText(A.optional);
      const line = await lab.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el.firstChild!); const b = r.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; });
      const o = await boxOf(opt);
      expect(Math.abs(o.y + o.h / 2 - (line.top + line.bottom) / 2), `${l}: (optional) on the label's line`).toBeLessThanOrEqual(3);
      const words = await lab.evaluate((el) => (el.firstChild?.textContent ?? '').trim());
      expect(words).toBe(l);
    }
  });

  test('AC-15 A-8 Phone: the drawer fills the screen; the title, every field, the notice and both buttons can be reached inside it, none under the top bar, nothing scrolls sideways', async ({ page, signIn, cognito, modules, hire, add }) => {
    test.skip(!phone(), 'Phone only: A-8 is the 390 wide screen');
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    const d = await ready(fx, true);
    const vp = page.viewportSize()!;
    const box = await boxOf(d);
    expect(Math.round(box.w), 'full width below 768 (D-RUI-02.8)').toBeGreaterThanOrEqual(vp.width - 1);
    expect(Math.round(box.h), 'full height').toBeGreaterThanOrEqual(vp.height - 1);
    const problems = await d.evaluate(async (root) => {
      const out: string[] = [];
      const width = document.documentElement.clientWidth;
      const bar = document.querySelector('pp-top-navigation')?.getBoundingClientRect();
      const barCovers = bar && getComputedStyle(document.querySelector('pp-top-navigation')!).zIndex !== 'auto';
      const targets = [...root.querySelectorAll<HTMLElement>('h2, label, input, select, summary, button, .pp-inline-message, .pp-form-error-summary')].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.closest('.pp-visually-hidden'); });
      for (const el of targets) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = el.getBoundingClientRect();
        const name = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)}"`;
        if (r.left < -1 || r.right > width + 1) out.push(`${name} is cut off sideways`);
        if (r.top < -1 || r.bottom > innerHeight + 1) out.push(`${name} cannot be scrolled into view`);
        const x = Math.min(Math.max(r.left + r.width / 2, 1), width - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        if (hit && !root.contains(hit)) out.push(`${name} is covered by ${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 30)}`);
        if (bar && barCovers && r.top < bar.bottom - 1 && hit && !root.contains(hit)) out.push(`${name} is under the top bar`);
      }
      if (document.documentElement.scrollWidth > width + 1) out.push('the page scrolls sideways');
      const body = root.querySelector('.pp-drawer__body') as HTMLElement | null;
      if (body && body.scrollWidth > body.clientWidth + 1) out.push('the drawer scrolls sideways');
      return out;
    });
    expect(problems).toEqual([]);
  });
});

// ================================================================ AC-16 Kit match and words
test.describe('AC-16 Kit match and words', () => {
  test.beforeEach(noBackendOnly);

  const DS = join(__dirname, '..', '..', 'src', 'styles', 'design-system');
  const known = (): Set<string> => new Set(['components.css', 'tokens/base.css'].flatMap((f) => readFileSync(join(DS, f), 'utf8').match(/\.pp-[a-z0-9_-]+/g) ?? []).map((c: string) => c.slice(1)));

  test('AC-16 The app is synced to the design system ref the drawer was captured at', async () => {
    const sync = JSON.parse(readFileSync(join(DS, 'sync.json'), 'utf8')) as { ref: string };
    expect(sync.ref, 'a design system change needs the drawer captured again (a child lock)').toBe(ADD_KIT.ref);
  });

  test('AC-16 The drawer matches the kit\'s "Add candidate" drawer but for the logged differences (no CV, no inline frame), and uses only design system parts', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const d = await openFrom(fx, 'candidates');
    await field(d, A.first).fill('Amahle');
    await openMore(d);
    const found = await d.evaluate((root) => ({
      classes: [...new Set([root, ...root.querySelectorAll('*')].flatMap((e) => [...e.classList]).filter((c) => c.startsWith('pp-')))],
      styled: [...root.querySelectorAll('[style]')].filter((e) => !/^(--[\w-]+:[^;]*;?\s*)+$/.test(e.getAttribute('style') ?? '')).map((e) => e.tagName.toLowerCase()),
      tags: [...new Set([...root.querySelectorAll('*')].map((e) => e.tagName.toLowerCase()).filter((t) => t.includes('-') && !t.startsWith('pp-') && !t.startsWith('app-')))],
    }));
    const logged = [/^pp-file-upload$/, /^pp-drawer--inline$/];
    const missing = ADD_KIT.drawer.filter((c) => !found.classes.includes(c) && !logged.some((re) => re.test(c)));
    expect(missing, 'classes the kit\'s drawer has and the page\'s lacks').toEqual([]);
    const have = known();
    expect(found.classes.filter((c) => !have.has(c)), 'every pp-* class exists in the design system').toEqual([]);
    expect(found.styled, 'no style attribute that sets a look').toEqual([]);
    expect(found.tags, 'no custom element but pp-* and app-*').toEqual([]);
    // The kit's parts in the kit's places.
    await expect(d).toHaveClass(/\bpp-drawer\b/);
    await expect(d.locator('.pp-drawer__body form.pp-drawer__form, .pp-drawer__body .pp-drawer__form')).toHaveCount(1);
    await expect(d.locator('.pp-drawer__footer').getByRole('button', { name: A.create, exact: true })).toHaveCount(1);
    await expect(d.locator('.pp-drawer__footer').getByRole('button', { name: A.cancel, exact: true })).toHaveCount(1);
    await expect(d.locator('.pp-accordion details.pp-accordion__item summary.pp-accordion__header')).toHaveCount(1);
    await expect(d.locator('.pp-accordion__title')).toHaveText(A.more);
    await expect(d.locator('.pp-accordion__meta')).toHaveText(A.moreMeta);
    await expect(d.locator('.pp-drawer__form .pp-inline-message')).toHaveText(A.notice('Amahle'));
  });

  test('AC-16 Every visible word in the drawer, in every state, is the kit\'s, a reused approved line or D-RUI-02.7; no old word', async ({ page, signIn, cognito, modules, hire, add }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, add };
    await enterAs(fx);
    const ALLOWED = new Set<string>([
      A.title, A.line, A.first, A.last, A.email, A.role, A.choose, A.more, A.moreMeta, `${A.more} ${A.moreMeta}`, A.phone, A.source, `${A.phone} ${A.optional}`, `${A.source} ${A.optional}`,
      `${A.phone}${A.optional}`, `${A.source}${A.optional}`, A.optional, ...A.sources, A.cancel, A.create, A.firstEmpty, A.lastEmpty, A.emailEmpty, A.emailWrong, A.roleEmpty, A.phoneWrong,
      A.roleClosed, A.roleNotFound, A.saveFail, A.rolesFail, A.tryAgain, A.noRoles, ...A_ROLE_TITLES, A.notice('Amahle'),
      ...[1, 2, 3, 4, 5, 6].map((n) => A.summary(n)),
      ...[[A.first, A.firstEmpty], [A.last, A.lastEmpty], [A.email, A.emailEmpty], [A.email, A.emailWrong], [A.role, A.roleEmpty], [A.phone, A.phoneWrong]].map(([l, t]) => `${l}: ${t}`),
    ]);
    const all: string[] = [];
    const look = async (d: Locator, state: string) => {
      const lines = await linesOf(d);
      for (const l of lines) expect(ALLOWED.has(l) || /^[\d\s()+]*$/.test(l), `${state}: "${l}" is an approved line`).toBe(true);
      all.push(...lines);
    };
    let d = await openFrom(fx, 'candidates');
    await look(d, 'fresh');
    await openMore(d);
    await createButton(d).click();
    await field(d, A.phone).fill('abc');
    await createButton(d).click();
    await look(d, 'every check');
    await fill(d, { ...GOOD, first: 'Amahle', phone: '082 555 0101', source: 'Referral' });
    await look(d, 'filled');
    // Lock check F5: while the request runs the drawer shows no words of its own (no "Adding...", "Saving...").
    add!.refuse({ hold: true, status: 500 });
    await createButton(d).click();
    await expect.poll(() => add!.heldCount).toBe(1);
    await page.waitForTimeout(300);
    await look(d, 'sending');
    add!.release();
    await expect(d.getByText(A.saveFail, { exact: true })).toBeVisible();
    await look(d, 'not saved');
    hire!.world.roles.find((r) => r.role_id === 'role-warehouse')!.status = 'CLOSED';
    await createButton(d).click();
    await expect(d.getByText(A.roleClosed, { exact: true })).toBeVisible();
    await look(d, 'role closed');
    await cancelButton(d).click();
    hire!.refuse({ method: 'GET', path: /\/v1\/roles$/, status: 500 });
    d = await openDrawer(page);
    await expect(d.getByText(A.rolesFail, { exact: true })).toBeVisible();
    await look(d, 'roles failed');
    for (const l of all) expect(l).not.toMatch(OLD_WORDS);
  });
});

// ================================================================ AC-17 pepla-dev (after merge, once REC-15 step B is on dev)
test.describe('AC-17 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-17 runs on pepla-dev only.');

  test('AC-17 @pepla-dev The HR test login adds a candidate to a seeded open role from its board and sees the name in Applied; the real preflight allows idempotency-key; company B does not see the candidate', async ({ page, signIn, hr }) => {
    const run = (process.env['GITHUB_RUN_ID'] ?? String(Date.now())).replace(/\D/g, '').slice(-10) || String(Date.now()).slice(-10);
    const last = `Check${run}`;
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto('/hire/roles');
    await expect(page.locator('main h1').first()).toHaveText('Roles');
    const link = main(page).getByRole('link', { name: 'Fleet controller', exact: true }).first();
    await expect(link, 'the seeded open role').toBeVisible();
    await link.click();
    await expect(page.locator('main h1').first()).toHaveText('Fleet controller');
    await expect(main(page).locator('.pp-pipeline').first()).toBeVisible();
    const d = await openDrawer(page);
    await expect.poll(() => chosen(d, A.role)).toBe('Fleet controller');
    await fill(d, { first: 'Dev', last, email: `e2e+${run}@example.com` });
    await createButton(d).click();
    await expect(drawer(page)).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(async () => ((await boardNow(page))['Applied'] ?? []).includes(`Dev ${last}`), { timeout: 20_000 }).toBe(true);
    // The real preflight of the add (LESSONS NH-187).
    const envFile = readFileSync(join(__dirname, '..', '..', 'src', 'environments', 'environment.ts'), 'utf8');
    const api = (/talentFlowApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(envFile)?.[1] ?? '').replace(/\/+$/, '');
    expect(api, 'the dev TalentFlow API address').toMatch(/^https:\/\//);
    const origin = new URL(process.env['E2E_BASE_URL'] ?? page.url()).origin;
    const pre = await page.request.fetch(`${api}/v1/candidates`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key' } });
    expect(pre.status(), 'the preflight passes').toBeLessThan(300);
    expect((pre.headers()['access-control-allow-headers'] ?? '').toLowerCase()).toContain('idempotency-key');
    // Company B's login does not see the candidate.
    const email = process.env['E2E_HR_B_EMAIL'] ?? process.env['E2E_B_HR_EMAIL'], password = process.env['E2E_HR_B_PASSWORD'] ?? process.env['E2E_B_HR_PASSWORD'];
    if (email && password) {
      await forgetSignIn(page);
      await signIn.open();
      await signIn.signInAs({ email, password });
      await expect(page).toHaveURL('/hr');
      for (const url of ['/hire/candidates', '/hire/pipeline']) {
        await page.goto(url);
        await quiet(page);
        await expect(page.getByText(`Dev ${last}`)).toHaveCount(0);
      }
    } else {
      test.info().annotations.push({ type: 'skipped part', description: 'E2E_HR_B_EMAIL and E2E_HR_B_PASSWORD are not set: the company B part did not run.' });
    }
  });
});
