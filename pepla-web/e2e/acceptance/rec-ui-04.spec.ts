import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page, Request } from '@playwright/test';
import { ON_DEV } from './support/fixtures';
import { FAILING_MODES } from './support/mod-02/modules-fake';
import { navHeadings, navItems, navLabels, openNav } from './support/mod-02/shell-snapshot';
import { COMPANY_ID, companyIdIn, enter, quiet, signInAs, watchErrors, type Who } from './support/rec-ui/harness';
import { KIT } from './support/rec-ui-04/kit';
import {
  BENEFITS, CAND, EXPIRY, NAMES, NEVER, NOTE, O, P, SALARY, SALARY_TEXT, START, TELLS_CANDIDATE, W, cardActions, day, expect, field, fillDate, main, norm, openOffer,
  stateCard, test, type OffersFake, type State,
} from './support/rec-ui-04/offers-fake';

/**
 * REC-UI-04 step A · Offers: the list, the offer page in every state, approve and send back, mark as sent, withdraw, record
 * Declined or Withdrawn, salary hidden and shown (Jira NH-230, epic NH-223, red). Lock acceptance-lock/rec-ui-04.
 * Spec: onboarding-cards/specs/REC-UI-04.md rules 1 to 14, AC-1 to AC-14 (step A); REC-UI-00.md. Backend: REC-05 (PR 507).
 * Where the card is silent, or where the kit drawn in DS PR 67 (K-1) differs from the card, cards/rec-ui-04.md says what these
 * tests take (decisions D-T-04.1 to D-T-04.9); the builder implements exactly that.
 *
 * Not in this lock: step B (Accepted with the signed copy, Employee record created, the rehire stop, the hired hand-over:
 * AC-15 to AC-19, child lock rec-ui-04.1 after REC-06), and the seeded part of AC-14 on pepla-dev (the offer seed goes in
 * scripts/ci/seed-dev.py, which the open key-access follow-up PR 511 changes; rule 3: child lock rec-ui-04.2 after 511 merges).
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg.
 * AC-14 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 */

const phone = () => test.info().project.name === 'phone-390';
const phoneOnly = (why: string) => test.skip(!phone(), `Phone only: ${why}`);
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');

type Fx = { page: Page; signIn: Parameters<typeof enter>[1]; cognito: Parameters<typeof enter>[2]; modules: Parameters<typeof enter>[3]; hire: Parameters<typeof enter>[4]; offers: OffersFake | null };

const h1 = (page: Page): Locator => page.locator('main h1, main [role="heading"][aria-level="1"]').first();
const table = (page: Page): Locator => main(page).getByRole('table', { name: W.caption, exact: true });
const btn = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true });
/** The dialog or drawer over the page (the design system draws a danger dialog as an alertdialog). */
const dialog = (page: Page): Locator => page.locator('[role="dialog"], [role="alertdialog"]').filter({ visible: true }).first();

async function as(fx: Fx, who: Who): Promise<void> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
}
async function openList(page: Page): Promise<void> {
  await page.goto('/hire/offers');
  await expect(h1(page)).toHaveText(W.offers);
  await quiet(page);
}

/** The rows of the Offers table, cell by cell, by the column names in the header. */
async function rows(page: Page): Promise<Array<Record<string, string>>> {
  await expect(table(page)).toBeVisible();
  return table(page).evaluate((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').replace(/\s+/g, ' ').trim());
    return [...t.querySelectorAll('tbody tr')].map((tr) => Object.fromEntries([...tr.querySelectorAll('td')].map((td, i) => {
      const c = td.cloneNode(true) as HTMLElement;
      c.querySelectorAll('[aria-hidden="true"], .pp-visually-hidden').forEach((x) => x.remove());
      return [heads[i] ?? `#${i}`, (c.textContent ?? '').replace(/[\s\u00a0]+/g, ' ').trim()];
    })));
  });
}

/** The dt/dd pairs of the state card, in order. */
async function facts(page: Page): Promise<Array<[string, string]>> {
  return stateCard(page).locator('dl').first().evaluate((dl) => {
    const out: Array<[string, string]> = [];
    let k: string | null = null;
    for (const el of [...dl.children]) {
      const t = (el.textContent ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
      if (el.tagName === 'DT') k = t;
      else if (el.tagName === 'DD' && k !== null) { out.push([k, t]); k = null; }
    }
    return out;
  });
}

/** The words of the state lozenge (kit: the lozenge in the card). */
const stateWord = async (page: Page) => norm(await stateCard(page).locator('.pp-lozenge').first().innerText());

/** The Approval chain part's text (opened first when shut). */
async function chainText(page: Page): Promise<string> {
  const item = main(page).locator('details').filter({ has: page.locator('summary', { hasText: W.chain }) }).first();
  await expect(item).toBeVisible();
  if ((await item.getAttribute('open')) === null) await item.locator('summary').click();
  const panel = item.locator(':scope > :not(summary)').first();
  return norm(await panel.innerText());
}

/** The section messages on the page that hold this exact title or body line. */
const messages = (page: Page, line: string) => main(page).locator('.pp-section-message').filter({ hasText: line });

/** Everything that goes out of the browser after this point, as host and path. */
function record(page: Page): Request[] {
  const out: Request[] = [];
  page.on('request', (r) => out.push(r));
  return out;
}

// ================================================================ AC-1 Who gets in (rule 1, REC-UI-00 rules 3 and 9)
test.describe('AC-1 Who gets in', () => {
  test.beforeEach(noBackendOnly);

  async function hireItems(page: Page): Promise<Array<{ label: string; href: string | null }>> {
    const s = await page.locator('pp-side-navigation .pp-side-navigation__section').evaluateAll((sections) =>
      sections.map((x) => ({ heading: (x.querySelector('.pp-side-navigation__heading')?.textContent ?? '').trim(), items: [...x.querySelectorAll('a.pp-side-navigation__item')].map((a) => ({ label: (a.querySelector('.pp-side-navigation__label')?.textContent ?? '').trim(), href: a.getAttribute('href') })) }))
        .find((x) => x.heading === 'Hire'));
    return s?.items ?? [];
  }

  test('AC-1 A Recruiter sees Offers last in Hire, with its link, and it opens the Offers page with no console error', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    const errors = watchErrors(page);
    await as(fx, P.recruiter);
    await openNav(page);
    await expect.poll(() => hireItems(page)).toEqual([
      { label: 'Roles', href: '/hire/roles' }, { label: 'Pipeline', href: '/hire/pipeline' }, { label: 'Candidates', href: '/hire/candidates' }, { label: W.offers, href: '/hire/offers' },
    ]);
    await navItems(page).filter({ hasText: /^Offers$/ }).click();
    await expect(page).toHaveURL(/\/hire\/offers$/);
    await expect(h1(page)).toHaveText(W.offers);
    await quiet(page);
    expect(errors, 'no console error').toEqual([]);
  });

  for (const [label, who] of [['the approver with the tick only (an employee)', P.approver], ['HR with the approver tick and no Recruitment tick', P.approverHr]] as const) {
    test(`AC-1 ${label} sees Offers and no other Hire entry; Offers and one offer open; Roles, Pipeline, Candidates and Draft a new offer send them away`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
      const { page, offers } = fx;
      const errors = watchErrors(page);
      await as(fx, who);
      await quiet(page);
      await openNav(page);
      await expect.poll(() => hireItems(page)).toEqual([{ label: W.offers, href: '/hire/offers' }]);
      await openList(page);
      await openOffer(page, O.waiting);
      await expect(stateCard(page)).toBeVisible();
      for (const path of ['/hire/roles', '/hire/pipeline', '/hire/candidates', `/hire/offers/new?candidate=${CAND.fresh}`]) {
        await page.goto(path);
        await quiet(page);
        await expect(page, `${path} sends them to their first page`).toHaveURL(who.lands!);
      }
      expect(offers!.to('POST', /\/v1\/offers/).length, 'they never write').toBe(0);
      expect(errors, 'no console error').toEqual([]);
    });
  }

  const DENIED: Array<[string, Who]> = [
    ['a Recruiter of company B (Recruitment off)', P.recruiterB], ['a Recruiter of company C (nothing on)', P.recruiterC], ['HR without either tick', P.hrNoTick],
    ['an employee with the Recruitment tick only', P.tickOnly], ['an Employee', P.employee], ['a hiring manager', P.manager],
    ['an employee of company B (Recruitment off) with the Approve offers tick', P.approverB],
  ];
  for (const [label, who] of DENIED) {
    test(`AC-1 ${label} has no Offers entry, is sent away from the three offer addresses and makes no offers request`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
      const { page, offers } = fx;
      const errors = watchErrors(page);
      await signInAs(fx.signIn, fx.cognito, fx.modules, fx.hire, who);
      if (who.lands) {
        await expect(page).toHaveURL(who.lands);
        await quiet(page);
        await openNav(page);
        expect(await navLabels(page), 'no Offers entry').not.toContain(W.offers);
      } else {
        await expect(page).toHaveURL(/\/sign-in/); // ONB-23 refuses the manager group at sign-in today (cards/rec-ui-01.md)
      }
      for (const path of ['/hire/offers', `/hire/offers/${O.sent}`, `/hire/offers/new?candidate=${CAND.fresh}`]) {
        await page.goto(path);
        await quiet(page);
        await expect(page, `${path} sends them away`).not.toHaveURL(/\/hire\//);
        if (who.lands) await expect(page).toHaveURL(who.lands);
      }
      expect(offers!.requests.map((c) => `${c.method} ${c.path}`), 'no offers request').toEqual([]);
      expect(errors, 'no console error').toEqual([]);
    });
  }

  for (const mode of FAILING_MODES) {
    test(`AC-1 With the modules call failing (${mode}) neither the Recruiter nor the approver gets Offers, and no offers request is made`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
      const { page, offers, modules } = fx;
      modules!.mode = mode;
      for (const who of [P.recruiter, P.approver]) {
        await signInAs(fx.signIn, fx.cognito, modules, fx.hire, who);
        await expect(page).toHaveURL(who.lands!);
        await quiet(page);
        await openNav(page);
        expect(await navLabels(page)).not.toContain(W.offers);
        await page.goto('/hire/offers');
        await quiet(page);
        await expect(page).toHaveURL(who.lands!);
        await page.context().clearCookies();
        await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      }
      expect(offers!.requests).toEqual([]);
    });
  }
});

// ================================================================ AC-2 Offers list (rule 2)
test.describe('AC-2 Offers list', () => {
  test.beforeEach(noBackendOnly);

  const ROW = (k: keyof typeof O, state: State, expires: string, approver: string) => ({ Candidate: NAMES[k], Role: '', State: W.states[state], Expires: expires, Approver: approver });

  test('AC-2 The Recruiter sees the title, the line, the five columns and every offer of the company in the server\'s order with the group E state words; no salary anywhere', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openList(page);
    await expect(main(page).getByText(W.line, { exact: true })).toBeVisible();
    const heads = (await table(page).locator('thead th').allTextContents()).map(norm).filter(Boolean);
    expect(heads.filter((x) => x !== 'Open'), 'the five columns').toEqual([...W.columns]);
    const got = await rows(page);
    const want = offers!.offers.filter((o) => o.company === 'A').sort((x, y) => y.created_at.localeCompare(x.created_at) || y.offer_id.localeCompare(x.offer_id));
    expect(got.map((r) => r['Candidate']), 'every offer of A, newest first, as the server sent them').toEqual(want.map((o) => o.candidate_name));
    for (const [r, o] of got.map((r, i) => [r, want[i]!] as const)) {
      expect([r['Role'], r['State'], r['Expires']], o.candidate_name).toEqual([o.role_title, W.states[o.state], day(o.expiry_date)]);
      const approver = o.approval?.approver_name ?? (o.state === 'DRAFT' ? o.approval_history.filter((a) => a.kind === 'SENT_BACK').at(-1)?.by_name : undefined) ?? '';
      expect(r['Approver'], `${o.candidate_name}: the approver column is the server's name or empty`).toBe(approver);
    }
    const html = await page.content();
    for (const s of [String(SALARY), '650 000', '650,000', SALARY_TEXT]) expect(html, `the list's page source holds no salary (${s})`).not.toContain(s);
    expect(offers!.reveals(), 'the list never asks for a salary').toEqual([]);
    void ROW;
  });

  test('AC-2 A row opens /hire/offers/{id} for that offer', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    await as(fx, P.recruiter);
    await openList(page);
    await table(page).locator('tbody tr').filter({ hasText: NAMES.sent }).getByRole('link', { name: NAMES.sent, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/hire/offers/${O.sent}$`));
    await expect(stateCard(page)).toBeVisible();
  });

  test('AC-2 The approver\'s list is exactly the server\'s answer: no draft nobody submitted, nothing filtered or added by the page', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.approver);
    await openList(page);
    const got = (await rows(page)).map((r) => r['Candidate']);
    const answer = offers!.offers.filter((o) => o.company === 'A' && o.submitted_at).sort((x, y) => y.created_at.localeCompare(x.created_at) || y.offer_id.localeCompare(x.offer_id)).map((o) => o.candidate_name);
    expect(got).toEqual(answer);
    expect(got, 'the never-submitted draft is not shown').not.toContain(NAMES.draft);
    // The page shows what the server sends: one more submitted offer appears on the next load, with no role check in the page.
    offers!.offers.find((o) => o.offer_id === O.draft)!.submitted_at = '2026-11-19T07:00:00.000Z';
    await openList(page);
    expect((await rows(page)).map((r) => r['Candidate'])).toContain(NAMES.draft);
    const lists = offers!.to('GET', /\/v1\/offers$/);
    for (const c of lists) expect(Object.keys(c.query).filter((k) => !['state', 'candidate_id', 'limit', 'nextToken'].includes(k)), 'no other query').toEqual([]);
  });

  test('AC-2 No offers says "No one yet"; a failed load says "Offers could not be loaded." with "Try again", which loads again', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    offers!.refuse({ method: 'GET', path: /\/v1\/offers$/, status: 500 });
    await page.goto('/hire/offers');
    await expect(main(page).getByText(W.failed, { exact: true })).toBeVisible();
    await expect(table(page)).toHaveCount(0);
    offers!.offers = offers!.offers.filter((o) => o.company !== 'A');
    await btn(main(page), W.tryAgain).click();
    await expect(main(page).getByText(W.empty, { exact: true })).toBeVisible();
    await expect(main(page).getByText(W.failed, { exact: true })).toHaveCount(0);
    expect(offers!.to('GET', /\/v1\/offers$/).length, 'Try again loads once more').toBe(2);
  });
});

// ================================================================ AC-3 State first (rule 3)
test.describe('AC-3 State first', () => {
  test.beforeEach(noBackendOnly);

  // [offer, viewer, the state word, the actions on the card, the dt/dd facts]
  const CASES: Array<[keyof typeof O, Who, string, string[], Array<[string, string]> | null]> = [
    ['draft', P.recruiter, 'Draft', [W.save, W.submit, W.withdraw], null],
    ['waiting', P.recruiter, 'Waiting for approval', [W.withdraw], null],
    ['waiting', P.recruiter2, 'Waiting for approval', [W.withdraw], null],
    ['waiting', P.approver, 'Waiting for approval', [W.approve, W.sendBack], null],
    ['approved', P.recruiter, 'Approved', [W.markSent, W.withdraw], [['Approved', '18 Nov 2026'], [W.approver, 'Sipho Ndlovu'], [W.expires, day(EXPIRY)]]],
    ['approved', P.approver, 'Approved', [], [['Approved', '18 Nov 2026'], [W.approver, 'Sipho Ndlovu'], [W.expires, day(EXPIRY)]]],
    ['sent', P.recruiter, 'Sent', [W.recordAnswer, W.withdraw], [[W.sentOn, '9 Nov 2026'], [W.replyDue, 'In 7 days'], [W.expires, day(EXPIRY)]]],
    ['sent', P.approver, 'Sent', [], [[W.sentOn, '9 Nov 2026'], [W.replyDue, 'In 7 days'], [W.expires, day(EXPIRY)]]],
    ['accepted', P.recruiter, 'Accepted', [], [['Accepted', '10 Nov 2026'], [W.expires, day(EXPIRY)]]],
    ['declined', P.recruiter, 'Declined', [], [['Declined', '10 Nov 2026'], [W.expires, day(EXPIRY)]]],
    ['expired', P.recruiter, 'Expired', [], [['Expired', '13 Nov 2026'], [W.expires, '12 Nov 2026']]],
    ['withdrawn', P.recruiter, 'Withdrawn', [], [['Withdrawn', '9 Nov 2026'], [W.expires, day(EXPIRY)]]],
    ['declined', P.approver, 'Declined', [], [['Declined', '10 Nov 2026'], [W.expires, day(EXPIRY)]]],
  ];
  for (const [k, who, word, actions, dl] of CASES) {
    test(`AC-3 ${word}, seen by ${who.full}: the state card shows "${word}", exactly ${actions.length ? actions.join(', ') : 'no action'}${dl ? ' and its dates' : ''}`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
      const { page } = fx;
      await as(fx, who);
      await openOffer(page, O[k]);
      expect(await stateWord(page), 'the state word').toBe(word);
      expect(await cardActions(page), 'exactly the actions of that state for that person').toEqual([...actions].sort());
      if (dl) expect(await facts(page), 'the card\'s facts, kit order (W-04.5 "{State} {date}")').toEqual(dl);
      await expect(main(page).getByText(/Log interaction|Candidate interactions/), 'no interactions block (U-6, no route)').toHaveCount(0);
    });
  }

  test('AC-3 The page leads with the candidate\'s name as its heading and the role, then the card titled "Offer" with "Created {date} by {name}"', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.sent);
    await expect(h1(page)).toHaveText(NAMES.sent);
    await expect(main(page).locator('.pp-person-header')).toContainText('Senior accountant');
    await expect(stateCard(page).getByText(W.created('5 Nov 2026', P.recruiter.full), { exact: true })).toBeVisible();
    const order = await main(page).evaluate((m) => {
      const head = m.querySelector('.pp-person-header'), card = [...m.querySelectorAll('article, .pp-card')].find((a) => a.querySelector('h2')?.textContent?.trim() === 'Offer'), acc = m.querySelector('.pp-accordion');
      const pos = (a: Element | null | undefined, b: Element | null | undefined) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return [pos(head, card), pos(card, acc)];
    });
    expect(order, 'person header, then the state card, then the accordion').toEqual([true, true]);
  });

  test('AC-3 Below the card: Offer details (Role, Department, Salary hidden, Start date, Benefits) and Approval chain ("{name} approved, {date}.")', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.sent);
    const details = main(page).locator('details').filter({ has: page.locator('summary', { hasText: W.details }) }).first();
    await expect(details).toBeVisible();
    if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
    const pairs = await details.locator('dl').evaluate((dl) => [...dl.querySelectorAll('dt')].map((dt) => [(dt.textContent ?? '').trim(), ((dt.nextElementSibling as HTMLElement | null)?.innerText ?? '').replace(/[\s\u00a0]+/g, ' ').trim()]));
    expect(pairs.map((p) => p[0]), 'the details, kit order').toEqual([W.role, W.department, W.salary, W.start, W.benefits]);
    expect(pairs.find((p) => p[0] === W.role)![1]).toBe('Senior accountant');
    expect(pairs.find((p) => p[0] === W.department)![1]).toBe('Finance');
    expect(pairs.find((p) => p[0] === W.start)![1]).toBe(day(START));
    expect(pairs.find((p) => p[0] === W.benefits)![1]).toBe(BENEFITS);
    await expect(details.getByLabel(W.salaryHidden, { exact: true })).toBeVisible();
    expect(await chainText(page)).toBe(W.approvedBy('Sipho Ndlovu', '8 Nov 2026'));
  });

  test('AC-3 While nobody has approved, the card names no approver and the chain says "Not approved yet." (D-T-04.2)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.waiting);
    expect((await facts(page).catch(() => [] as Array<[string, string]>)).map((p) => p[0]), 'no Approver row').not.toContain(W.approver);
    expect(await chainText(page)).toBe(W.notYet);
    await expect(stateCard(page)).not.toContainText('Sipho');
  });
});

// ================================================================ AC-4 Draft (rule 4)
test.describe('AC-4 Draft', () => {
  test.beforeEach(noBackendOnly);

  async function fillForm(page: Page, v: { salary?: string; start?: string; expiry?: string; benefits?: string }): Promise<void> {
    if (v.salary !== undefined) await field(page, W.salary).fill(v.salary);
    if (v.start !== undefined) await fillDate(field(page, W.start), v.start);
    if (v.expiry !== undefined) await fillDate(field(page, W.expires), v.expiry);
    if (v.benefits !== undefined) await field(page, W.benefits).fill(v.benefits);
  }
  async function openNew(page: Page, cand: string): Promise<void> {
    await page.goto(`/hire/offers/new?candidate=${cand}`);
    await expect(stateCard(page)).toBeVisible();
    await expect(field(page, W.salary)).toBeVisible();
  }

  test('AC-4 A new draft: Salary with ZAR beside it, Start date, Offer expires, Benefits (optional); no role is typed; the first save is one POST with a key and no role, title or company', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openNew(page, CAND.fresh);
    await expect(stateCard(page).getByText(W.zar, { exact: true })).toBeVisible();
    await expect(stateCard(page).getByText(W.optional, { exact: true })).toBeVisible();
    await expect(stateCard(page).getByRole('textbox', { name: /^Role/ }), 'the role is never typed').toHaveCount(0);
    await expect(stateCard(page).getByRole('combobox'), 'nor chosen').toHaveCount(0);
    await fillForm(page, { salary: '650000.00', start: START, expiry: EXPIRY, benefits: BENEFITS });
    await btn(stateCard(page), W.save).click();
    await expect.poll(() => offers!.to('POST', /\/v1\/offers$/).length).toBe(1);
    await quiet(page);
    const post = offers!.to('POST', /\/v1\/offers$/)[0]!;
    expect(post.idempotencyKey, 'the first save carries an Idempotency-Key').toBeTruthy();
    const body = post.body as Record<string, unknown>;
    expect(Object.keys(body).filter((key) => !['candidate_id', 'salary', 'start_date', 'expiry_date', 'benefits', 'currency'].includes(key)), 'no other key (no role, title, department or company)').toEqual([]);
    expect(body).toMatchObject({ candidate_id: CAND.fresh, salary: SALARY, start_date: START, expiry_date: EXPIRY, benefits: BENEFITS });
    if ('currency' in body) expect(body['currency']).toBe('ZAR');
    expect(offers!.to('PATCH', /./), 'nothing else written').toEqual([]);
  });

  test('AC-4 Later saves are one PATCH each with the version read last and only the fields, never a second POST', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openNew(page, CAND.fresh);
    await fillForm(page, { salary: '650000', start: START, expiry: EXPIRY });
    await btn(stateCard(page), W.save).click();
    await expect.poll(() => offers!.to('POST', /\/v1\/offers$/).length).toBe(1);
    await expect(stateWord(page)).resolves.toBe('Draft');
    await field(page, W.benefits).fill('Medical aid');
    await btn(stateCard(page), W.save).click();
    await expect.poll(() => offers!.to('PATCH', /\/v1\/offers\/[^/]+$/).length).toBe(1);
    const patch = offers!.to('PATCH', /\/v1\/offers\/[^/]+$/)[0]!;
    const made = offers!.offers.at(-1)!;
    expect(patch.path, 'the PATCH goes to the new offer').toMatch(new RegExp(`/v1/offers/${made.offer_id}$`));
    expect(patch.idempotencyKey, 'with a key').toBeTruthy();
    expect(patch.idempotencyKey).not.toBe(offers!.to('POST', /\/v1\/offers$/)[0]!.idempotencyKey);
    const body = patch.body as Record<string, unknown>;
    expect(body['version'], 'the version of the last answer').toBe(1);
    expect(body['benefits']).toBe('Medical aid');
    expect(Object.keys(body).filter((key) => !['version', 'salary', 'start_date', 'expiry_date', 'benefits'].includes(key)), 'only the four fields and the version').toEqual([]);
    expect(offers!.to('POST', /\/v1\/offers$/).length, 'never a second POST').toBe(1);
  });

  const CHECKS: Array<[string, { salary?: string; start?: string; expiry?: string; benefits?: string }, string, string]> = [
    ['an empty salary', { salary: '', start: START, expiry: EXPIRY }, W.salary, W.salaryCheck],
    ['a salary of 0', { salary: '0', start: START, expiry: EXPIRY }, W.salary, W.salaryCheck],
    ['a start date of today', { salary: '650000', start: '2026-11-19', expiry: '2026-11-19' }, W.start, W.startCheck],
    ['an expiry after the start date', { salary: '650000', start: START, expiry: '2026-12-02' }, W.expires, W.expiryCheck],
    ['an expiry of today', { salary: '650000', start: START, expiry: '2026-11-19' }, W.expires, W.expiryCheck],
  ];
  for (const [what, v, label, line] of CHECKS) {
    test(`AC-4 ${what} shows "${line}" under ${label} and sends nothing`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
      const { page, offers } = fx;
      await as(fx, P.recruiter);
      await openNew(page, CAND.fresh);
      await fillForm(page, v);
      await btn(stateCard(page), W.save).click();
      const f = stateCard(page).locator('.pp-field').filter({ has: page.getByText(label, { exact: true }) }).first();
      await expect(f.getByText(line, { exact: true })).toBeVisible();
      await quiet(page);
      expect(offers!.requests.filter((c) => c.method !== 'GET'), 'nothing written').toEqual([]);
      await btn(stateCard(page), W.submit).click();
      await quiet(page);
      expect(offers!.requests.filter((c) => c.method !== 'GET'), 'Submit for approval sends nothing either').toEqual([]);
    });
  }

  test('AC-4 Benefits over 2000 characters: either the field holds no more than 2000 or "Keep benefits to 2000 characters." shows and nothing is sent', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openNew(page, CAND.fresh);
    await fillForm(page, { salary: '650000', start: START, expiry: EXPIRY, benefits: 'b'.repeat(2001) });
    const held = (await field(page, W.benefits).inputValue()).length;
    await btn(stateCard(page), W.save).click();
    if (held > 2000) {
      await expect(stateCard(page).getByText(W.benefitsCheck, { exact: true })).toBeVisible();
      await quiet(page);
      expect(offers!.requests.filter((c) => c.method !== 'GET')).toEqual([]);
    } else {
      await expect.poll(() => offers!.to('POST', /\/v1\/offers$/).length).toBe(1);
      expect(((offers!.to('POST', /\/v1\/offers$/)[0]!.body as Record<string, string>)['benefits'] ?? '').length).toBeLessThanOrEqual(2000);
    }
  });

  test('AC-4 A 400 field refusal from the server shows that field\'s W-04.7 words and keeps what was typed', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openNew(page, CAND.fresh);
    offers!.refuse({ method: 'POST', path: /\/v1\/offers$/, status: 400, body: { error: 'Bad request', code: 'INVALID_FIELD', field: 'start_date' } });
    await fillForm(page, { salary: '650000', start: START, expiry: EXPIRY, benefits: 'Kept words' });
    await btn(stateCard(page), W.save).click();
    await expect(stateCard(page).locator('.pp-field').filter({ has: page.getByText(W.start, { exact: true }) }).first().getByText(W.startCheck, { exact: true })).toBeVisible();
    await expect(field(page, W.benefits)).toHaveValue('Kept words');
  });

  test('AC-4 Submit for approval with an unsaved change saves it first (one PATCH), then submits once; the card then reads Waiting for approval with the drafter line', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.draft);
    await field(page, W.benefits).fill('Medical aid only');
    await btn(stateCard(page), W.submit).click();
    await expect.poll(() => offers!.to('POST', /\/submit$/).length).toBe(1);
    const patch = offers!.to('PATCH', /./);
    expect(patch.length, 'the change is saved first').toBe(1);
    expect(patch[0]!.seq, 'before the submit').toBeLessThan(offers!.to('POST', /\/submit$/)[0]!.seq);
    expect((patch[0]!.body as Record<string, unknown>)['benefits']).toBe('Medical aid only');
    expect(patch[0]!.body, 'the Salary field was left empty, so no salary is sent (D-T-04.5)').not.toHaveProperty('salary');
    await expect.poll(() => stateWord(page)).toBe('Waiting for approval');
    await expect(stateCard(page).getByText(W.drafter, { exact: true })).toBeVisible();
    await quiet(page);
    expect(offers!.to('POST', /\/submit$/).length, 'submitted once').toBe(1);
  });

  test('AC-4 Submit for approval with nothing changed sends no PATCH, and a double press submits once', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.draft);
    offers!.refuse({ method: 'POST', path: /\/submit$/, hold: true });
    await btn(stateCard(page), W.submit).dblclick();
    await quiet(page);
    offers!.release();
    await expect.poll(() => stateWord(page)).toBe('Waiting for approval');
    expect(offers!.to('POST', /\/submit$/).length).toBe(1);
    expect(offers!.to('PATCH', /./)).toEqual([]);
  });

  test('AC-4 NO_APPROVER leaves it Draft with the W-04.6 line once, and the offer is read again once', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    offers!.noApprover = true;
    await as(fx, P.recruiter);
    await openOffer(page, O.draft);
    const before = offers!.reads(O.draft).length;
    await btn(stateCard(page), W.submit).click();
    await expect(messages(page, W.noApprover)).toHaveCount(1);
    await quiet(page);
    expect(await stateWord(page)).toBe('Draft');
    expect(offers!.reads(O.draft).length - before, 'read again once').toBe(1);
  });

  test('AC-4 A draft that was sent back shows "{name} sent this back:" with the note, in a section message on the card', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.sentBack);
    const msg = stateCard(page).locator('.pp-section-message').filter({ hasText: W.sentBackBy('Sipho Ndlovu') });
    await expect(msg).toHaveCount(1);
    await expect(msg).toContainText(NOTE);
    expect(await stateWord(page)).toBe('Draft');
  });

  test('AC-4 A draft for a candidate who already has an open offer: OFFER_EXISTS shows "This candidate already has an open offer."', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    await as(fx, P.recruiter);
    await openNew(page, CAND.sent);
    await fillForm(page, { salary: '650000', start: START, expiry: EXPIRY });
    await btn(stateCard(page), W.save).click();
    await expect(messages(page, W.offerExists)).toHaveCount(1);
  });
});

// ================================================================ AC-5 Approver and drafter (rule 5)
test.describe('AC-5 Approver and drafter', () => {
  test.beforeEach(noBackendOnly);

  const note = (page: Page) => stateCard(page).getByLabel(W.sendBackPrompt, { exact: true });

  test('AC-5 The approver approves with one request carrying the version, even on a double press; the card then reads Approved with their name', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.approver);
    await openOffer(page, O.waiting);
    const v = offers!.offer(O.waiting).version;
    offers!.refuse({ method: 'POST', path: /\/approve$/, hold: true });
    await btn(stateCard(page), W.approve).dblclick();
    await quiet(page);
    offers!.release();
    await expect.poll(() => stateWord(page)).toBe('Approved');
    expect(offers!.to('POST', /\/approve$/).length, 'one request').toBe(1);
    expect((offers!.to('POST', /\/approve$/)[0]!.body as Record<string, unknown>)['version']).toBe(v);
    expect(await facts(page)).toEqual(expect.arrayContaining([['Approved', '19 Nov 2026'], [W.approver, P.approver.full]]));
  });

  test('AC-5 Send back stays off until the note has text; it sends one request with the note and the version, even on a double press', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.approver);
    await openOffer(page, O.waiting);
    await expect(note(page)).toBeVisible();
    await expect(btn(stateCard(page), W.sendBack)).toBeDisabled();
    await note(page).fill('   ');
    await expect(btn(stateCard(page), W.sendBack), 'spaces only are no note').toBeDisabled();
    await note(page).fill(NOTE);
    await expect(btn(stateCard(page), W.sendBack)).toBeEnabled();
    offers!.refuse({ method: 'POST', path: /\/send-back$/, hold: true });
    await btn(stateCard(page), W.sendBack).dblclick();
    await quiet(page);
    offers!.release();
    await expect.poll(() => stateWord(page)).toBe('Draft');
    const calls = offers!.to('POST', /\/send-back$/);
    expect(calls.length).toBe(1);
    expect(calls[0]!.body).toEqual({ note: NOTE, version: 2 });
    expect(offers!.to('POST', /\/approve$/)).toEqual([]);
  });

  test('AC-5 After a send back the Recruiter sees the Draft card with "{approver} sent this back:" and the note', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    await as(fx, P.approver);
    await openOffer(page, O.waiting);
    await note(page).fill('Please lower the salary.');
    await btn(stateCard(page), W.sendBack).click();
    await expect.poll(() => stateWord(page)).toBe('Draft');
    await page.context().clearCookies();
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await as(fx, P.recruiter);
    await openOffer(page, O.waiting);
    const msg = stateCard(page).locator('.pp-section-message').filter({ hasText: W.sentBackBy(P.approver.full) });
    await expect(msg).toContainText('Please lower the salary.');
    expect(await cardActions(page)).toEqual([W.save, W.submit, W.withdraw].sort());
  });

  for (const [who, offer, label] of [[P.recruiter, O.waiting, 'the Recruiter who drafted it'], [P.both, O.bothDraft, 'a person with both ticks who drafted it']] as const) {
    test(`AC-5 For ${label}: the drafter line, no Approve and no Send back`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
      const { page, offers } = fx;
      await as(fx, who);
      await openOffer(page, offer);
      await expect(stateCard(page).getByText(W.drafter, { exact: true })).toBeVisible();
      const acts = await cardActions(page);
      expect(acts).not.toContain(W.approve);
      expect(acts).not.toContain(W.sendBack);
      await expect(stateCard(page).getByLabel(W.sendBackPrompt, { exact: true })).toHaveCount(0);
      expect(offers!.to('POST', /\/(approve|send-back)$/)).toEqual([]);
    });
  }

  test('AC-5 Drafter or not is decided by drafted_by_me alone: flipping it, with the same roles, swaps the approver\'s and the both-ticks person\'s views', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    offers!.draftedByMe.set(O.waiting, true);
    await as(fx, P.approver);
    await openOffer(page, O.waiting);
    await expect(stateCard(page).getByText(W.drafter, { exact: true }), 'the approver told "you drafted this" sees the drafter line').toBeVisible();
    expect(await cardActions(page)).not.toContain(W.approve);
    await page.context().clearCookies();
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    offers!.draftedByMe.set(O.bothDraft, false);
    await as(fx, P.both);
    await openOffer(page, O.bothDraft);
    await expect(stateCard(page).getByText(W.drafter, { exact: true }), 'the both-ticks drafter told "not you" gets no drafter line').toHaveCount(0);
    expect(await cardActions(page)).toEqual(expect.arrayContaining([W.approve, W.sendBack]));
  });

  test('AC-5 The server\'s 403 on Approve shows the drafter line and nothing else', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.approver);
    await openOffer(page, O.waiting);
    offers!.refuse({ method: 'POST', path: /\/approve$/, status: 403, body: { error: 'Forbidden' } });
    await btn(stateCard(page), W.approve).click();
    await expect(main(page).getByText(W.drafter, { exact: true })).toHaveCount(1);
    await expect(main(page).getByText(W.generic, { exact: true })).toHaveCount(0);
    await expect(main(page).getByText(W.changed, { exact: true })).toHaveCount(0);
  });

  test('AC-5 NOTE_REQUIRED from the server shows "Say what needs to change." once', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.approver);
    await openOffer(page, O.waiting);
    offers!.refuse({ method: 'POST', path: /\/send-back$/, status: 400, body: { error: 'Bad request', code: 'NOTE_REQUIRED' } });
    await note(page).fill('x');
    await btn(stateCard(page), W.sendBack).click();
    await expect(messages(page, W.noteRequired)).toHaveCount(1);
  });
});

// ================================================================ AC-6 Mark as sent (rule 6)
test.describe('AC-6 Mark as sent', () => {
  test.beforeEach(noBackendOnly);

  test('AC-6 No "Mark as sent" before Approved, for anyone', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    await as(fx, P.both);
    for (const id of [O.draft, O.sentBack, O.waiting, O.bothDraft]) {
      await openOffer(page, id);
      await expect(main(page).getByRole('button', { name: W.markSent }), id).toHaveCount(0);
    }
  });

  test('AC-6 On an Approved offer "Mark as sent" makes one request; the card then reads Sent with Sent {date}, Reply due In {n} days and Offer expires, as the kit draws it', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.approved);
    await btn(stateCard(page), W.markSent).dblclick();
    await expect.poll(() => stateWord(page)).toBe('Sent');
    await quiet(page);
    expect(offers!.to('POST', /\/send$/).length).toBe(1);
    expect(await facts(page)).toEqual([[W.sentOn, '19 Nov 2026'], [W.replyDue, 'In 7 days'], [W.expires, day(EXPIRY)]]);
    expect(await cardActions(page)).toEqual([W.recordAnswer, W.withdraw].sort());
  });

  test('AC-6 NOT_APPROVED shows exactly "This offer is not approved yet." once and reads the offer again once', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.approved);
    offers!.refuse({ method: 'POST', path: /\/send$/, status: 409, body: { error: 'Conflict', code: 'NOT_APPROVED' } });
    const before = offers!.reads(O.approved).length;
    await btn(stateCard(page), W.markSent).click();
    await expect(messages(page, W.notApproved)).toHaveCount(1);
    await expect(main(page).getByText(W.notApproved, { exact: true })).toHaveCount(1);
    await quiet(page);
    expect(offers!.reads(O.approved).length - before).toBe(1);
  });
});

// ================================================================ AC-7 Salary (rule 8)
test.describe('AC-7 Salary', () => {
  test.beforeEach(noBackendOnly);

  const salaryIn = (s: string) => [String(SALARY), '650 000', '650,000', '650\u00a0000', SALARY_TEXT].some((x) => s.includes(x));

  test('AC-7 Hidden on the offer page; "Show" makes one reveal request and shows 650 000.00; "Hide" and a reload hide it again with no new request', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.sent);
    await expect(main(page).getByLabel(W.salaryHidden, { exact: true })).toBeVisible();
    expect(salaryIn(await page.content()), 'no salary in the page source').toBe(false);
    await btn(main(page), W.show).click();
    await expect.poll(async () => norm(await main(page).innerText())).toContain(SALARY_TEXT);
    expect(offers!.reveals().length, 'one reveal request').toBe(1);
    expect(offers!.reveals()[0]!.path).toMatch(new RegExp(`/v1/offers/${O.sent}$`));
    await btn(main(page), W.hide).click();
    await expect(main(page).getByLabel(W.salaryHidden, { exact: true })).toBeVisible();
    expect(salaryIn(await page.content()), 'Hide takes it out of the page').toBe(false);
    await page.reload();
    await expect(stateCard(page)).toBeVisible();
    await quiet(page);
    expect(salaryIn(await page.content()), 'a reload shows it hidden').toBe(false);
    expect(offers!.reveals().length, 'and asks for nothing').toBe(1);
  });

  test('AC-7 The shown salary is in no address, storage, console line or other request', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    const lines: string[] = [];
    page.on('console', (m) => lines.push(m.text()));
    const out = record(page);
    await as(fx, P.recruiter);
    await openOffer(page, O.approved);
    await btn(main(page), W.show).click();
    await expect.poll(async () => norm(await main(page).innerText())).toContain(SALARY_TEXT);
    await openList(page);
    await openOffer(page, O.approved);
    const store = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, h: history.state, u: location.href }));
    expect(salaryIn(store), 'not in storage, history or the address').toBe(false);
    expect(lines.filter(salaryIn), 'not in the console').toEqual([]);
    const sent = out.filter((r) => salaryIn(`${r.url()} ${r.postData() ?? ''}`));
    expect(sent.map((r) => r.url()), 'not in any request').toEqual([]);
    expect(offers!.reveals().length).toBe(1);
  });

  test('AC-7 can_reveal_salary false: no "Show" button and no reveal request', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    offers!.canReveal.set(O.sent, false);
    await as(fx, P.recruiter);
    await openOffer(page, O.sent);
    await expect(main(page).getByLabel(W.salaryHidden, { exact: true })).toBeVisible();
    await expect(btn(main(page), W.show)).toHaveCount(0);
    await quiet(page);
    expect(offers!.reveals()).toEqual([]);
  });

  test('AC-7 The approver may reveal too: one request, and the list never shows it', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.approver);
    await openOffer(page, O.waiting);
    await btn(main(page), W.show).click();
    await expect.poll(async () => norm(await main(page).innerText())).toContain(SALARY_TEXT);
    expect(offers!.reveals().length).toBe(1);
    await openList(page);
    expect(salaryIn(await page.content())).toBe(false);
  });
});

// ================================================================ AC-8 Withdraw and Declined (rules 7 and 9)
test.describe('AC-8 Withdraw and Declined', () => {
  test.beforeEach(noBackendOnly);

  test('AC-8 "Withdraw offer" opens "Withdraw this offer?" with "Note (optional)", Cancel and Withdraw offer; Cancel sends nothing', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.approved);
    await btn(stateCard(page), W.withdraw).click();
    const d = dialog(page);
    await expect(d).toBeVisible();
    await expect(d.getByRole('heading', { name: W.withdrawTitle, exact: true })).toBeVisible();
    await expect(d.getByLabel(W.note, { exact: false })).toBeVisible();
    await expect(d.getByText(W.optional, { exact: true })).toBeVisible();
    expect((await d.getByRole('button').allTextContents()).map(norm).filter((x) => x && x !== 'Close').sort()).toEqual([W.cancel, W.withdraw].sort());
    await btn(d, W.cancel).click();
    await expect(d).toBeHidden();
    await quiet(page);
    expect(offers!.to('POST', /\/withdraw$/)).toEqual([]);
    expect(await stateWord(page)).toBe('Approved');
  });

  for (const k of ['draft', 'waiting', 'approved', 'sent'] as const) {
    test(`AC-8 Withdrawing ${k === 'approved' ? 'an' : 'a'} ${W.states[offerState(k)]} offer: one request with the note; the card then reads "Withdrawn 19 Nov 2026" with no action`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
      const { page, offers } = fx;
      await as(fx, P.recruiter);
      await openOffer(page, O[k]);
      await btn(stateCard(page), W.withdraw).click();
      const d = dialog(page);
      await d.getByLabel(W.note, { exact: false }).fill('Role filled internally.');
      await btn(d, W.withdraw).dblclick();
      await expect.poll(() => stateWord(page)).toBe('Withdrawn');
      await quiet(page);
      const calls = offers!.to('POST', /\/withdraw$/);
      expect(calls.length).toBe(1);
      expect(calls[0]!.path).toMatch(new RegExp(`/v1/offers/${O[k]}/withdraw$`));
      expect((calls[0]!.body as Record<string, unknown>)['note']).toBe('Role filled internally.');
      expect((await facts(page))[0]).toEqual(['Withdrawn', '19 Nov 2026']);
      expect(await cardActions(page)).toEqual([]);
    });
  }

  test('AC-8 Record answer: drawer "Record answer", "{candidate} · {role}", only Declined and Withdrawn (no Accepted in step A)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.sent);
    await btn(stateCard(page), W.recordAnswer).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: W.recordAnswer, exact: true })).toBeVisible();
    await expect(d.getByText(`${NAMES.sent} · Senior accountant`, { exact: true })).toBeVisible();
    const choices = (await d.getByRole('radio').evaluateAll((rs) => rs.map((r) => ((r as HTMLInputElement).labels?.[0]?.textContent ?? r.getAttribute('aria-label') ?? '').trim())));
    expect(choices, 'Declined and Withdrawn only').toEqual([...W.answers]);
    await expect(d.getByText(W.accepted, { exact: true })).toHaveCount(0);
    await expect(d.getByText(/Signed offer|Upload the signed copy|Confirm acceptance|Confirmed start date|When you confirm/)).toHaveCount(0);
    await quiet(page);
    expect(offers!.to('POST', /\/(answer|signed-upload)$/)).toEqual([]);
  });

  test('AC-8 Recording Declined: one request with the answer and a key, even on a double press; the card then reads "Declined 19 Nov 2026"', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.sent);
    await btn(stateCard(page), W.recordAnswer).click();
    const d = dialog(page);
    await d.getByRole('radio', { name: 'Declined', exact: true }).dispatchEvent('click');
    offers!.refuse({ method: 'POST', path: /\/answer$/, hold: true });
    await btn(d, W.recordAnswer).dblclick();
    await quiet(page);
    offers!.release();
    await expect.poll(() => stateWord(page)).toBe('Declined');
    const calls = offers!.to('POST', /\/answer$/);
    expect(calls.length).toBe(1);
    expect(calls[0]!.body).toEqual({ answer: 'DECLINED' });
    expect(calls[0]!.idempotencyKey, 'with an Idempotency-Key').toBeTruthy();
    expect((await facts(page))[0]).toEqual(['Declined', '19 Nov 2026']);
    await expect(dialog(page)).toHaveCount(0);
  });

  test('AC-8 Recording Withdrawn through Record answer sends answer WITHDRAWN once', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.sent);
    await btn(stateCard(page), W.recordAnswer).click();
    const d = dialog(page);
    await d.getByRole('radio', { name: 'Withdrawn', exact: true }).dispatchEvent('click');
    await btn(d, W.recordAnswer).click();
    await expect.poll(() => stateWord(page)).toBe('Withdrawn');
    expect(offers!.to('POST', /\/answer$/).map((c) => c.body)).toEqual([{ answer: 'WITHDRAWN' }]);
  });
});
function offerState(k: 'draft' | 'waiting' | 'approved' | 'sent'): State { return ({ draft: 'DRAFT', waiting: 'WAITING_APPROVAL', approved: 'APPROVED', sent: 'SENT' } as const)[k]; }

// ================================================================ AC-9 Refusals (rule 13)
test.describe('AC-9 Refusals', () => {
  test.beforeEach(noBackendOnly);

  // [code, status, the action that meets it]
  const CODES: Array<[string, number, string, () => { offer: string; who: Who; act: (p: Page) => Promise<void>; re: RegExp }]> = [
    ['STALE', 409, W.changed, () => ({ offer: O.waiting, who: P.approver, act: (p) => btn(stateCard(p), W.approve).click(), re: /\/approve$/ })],
    ['NOT_WAITING', 409, W.changed, () => ({ offer: O.waiting, who: P.approver, act: (p) => btn(stateCard(p), W.approve).click(), re: /\/approve$/ })],
    ['NOT_OPEN', 409, W.changed, () => ({ offer: O.approved, who: P.recruiter, act: async (p) => { await btn(stateCard(p), W.withdraw).click(); await btn(dialog(p), W.withdraw).click(); }, re: /\/withdraw$/ })],
    ['NOT_SENT', 409, W.changed, () => ({ offer: O.sent, who: P.recruiter, act: async (p) => { await btn(stateCard(p), W.recordAnswer).click(); await dialog(p).getByRole('radio', { name: 'Declined', exact: true }).dispatchEvent('click'); await btn(dialog(p), W.recordAnswer).click(); }, re: /\/answer$/ })],
    ['NOT_DRAFT', 409, W.changed, () => ({ offer: O.draft, who: P.recruiter, act: (p) => btn(stateCard(p), W.submit).click(), re: /\/submit$/ })],
    ['NO_APPROVER', 409, W.noApprover, () => ({ offer: O.draft, who: P.recruiter, act: (p) => btn(stateCard(p), W.submit).click(), re: /\/submit$/ })],
    ['NOT_APPROVED', 409, W.notApproved, () => ({ offer: O.approved, who: P.recruiter, act: (p) => btn(stateCard(p), W.markSent).click(), re: /\/send$/ })],
  ];
  for (const [code, status, line, setup] of CODES) {
    test(`AC-9 ${code} shows "${line}" once at the top of the state card and reads the offer again once`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
      const { page, offers } = fx;
      const s = setup();
      await as(fx, s.who);
      await openOffer(page, s.offer);
      offers!.refuse({ method: 'POST', path: s.re, status, body: { error: 'Conflict', code } });
      const before = offers!.reads(s.offer).length;
      await s.act(page);
      await expect(messages(page, line)).toHaveCount(1);
      await expect(main(page).getByText(line, { exact: true })).toHaveCount(1);
      const msg = messages(page, line).first();
      const inCardTop = await msg.evaluate((m) => {
        const card = [...document.querySelectorAll('main article, main .pp-card')].find((a) => a.querySelector('h2')?.textContent?.trim() === 'Offer');
        if (!card) return 'no card';
        if (!card.contains(m)) return 'outside the card';
        const header = card.querySelector('header');
        const dl = card.querySelector('dl, form, .pp-card__footer');
        return (!header || !!(header.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING)) && (!dl || !!(m.compareDocumentPosition(dl) & Node.DOCUMENT_POSITION_FOLLOWING)) ? 'top' : 'not at the top';
      });
      expect(inCardTop, 'a section message at the top of the state card').toBe('top');
      await quiet(page);
      expect(offers!.reads(s.offer).length - before, 'the offer is read again once').toBe(1);
    });
  }

  test('AC-9 An unknown offer id and another company\'s offer id both show "This offer could not be found." and no card', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    await as(fx, P.recruiter);
    for (const id of ['offer-5e1d0c4a-0000-4000-8000-999999999999', O.b]) {
      await page.goto(`/hire/offers/${id}`);
      await expect(main(page).getByText(W.notFound, { exact: true })).toBeVisible();
      await expect(stateCard(page)).toHaveCount(0);
      expect(await page.content()).not.toContain(NAMES.b);
    }
  });

  test('AC-9 Any other failure shows "Your change could not be saved. Try again." and keeps what was typed', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.draft);
    for (const r of [{ status: 500 }, { abort: true }, { status: 400, body: { error: 'Bad request', code: 'NO_FIELDS' } }]) {
      offers!.refuse({ method: 'PATCH', path: /\/v1\/offers\/[^/]+$/, ...r });
      await field(page, W.benefits).fill(`Typed ${JSON.stringify(r).length}`);
      await btn(stateCard(page), W.save).click();
      await expect(main(page).getByText(W.generic, { exact: true })).toHaveCount(1);
      await expect(field(page, W.benefits)).toHaveValue(`Typed ${JSON.stringify(r).length}`);
      expect(await stateWord(page)).toBe('Draft');
    }
  });
});

// ================================================================ AC-10 Nothing sent to the candidate (rule 6)
test.describe('AC-10 Nothing sent', () => {
  test.beforeEach(noBackendOnly);

  test('AC-10 No offer page, dialog or drawer says the candidate is emailed, sent anything or told; the only API calls are /v1/offers and what the shell already makes', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    await as(fx, P.recruiter);
    // What the shell makes on another Hire page: those calls are not the offer screens'.
    const base = record(page);
    await page.goto('/hire/roles');
    await quiet(page);
    const shell = new Set(base.map((r) => { const u = new URL(r.url()); return `${u.host}${u.pathname}`; }));
    const out = record(page);
    const texts: string[] = [];
    await openList(page);
    texts.push(await main(page).innerText());
    for (const id of Object.values(O).filter((x) => x !== O.b)) {
      await openOffer(page, id);
      texts.push(await main(page).innerText());
    }
    await openOffer(page, O.approved);
    await btn(stateCard(page), W.withdraw).click();
    texts.push(await dialog(page).innerText());
    await btn(dialog(page), W.cancel).click();
    await openOffer(page, O.sent);
    await btn(stateCard(page), W.recordAnswer).click();
    texts.push(await dialog(page).innerText());
    await page.keyboard.press('Escape');
    await openOffer(page, O.approved);
    await btn(stateCard(page), W.markSent).click();
    await expect.poll(() => stateWord(page)).toBe('Sent');
    texts.push(await main(page).innerText());
    await page.goto(`/hire/offers/new?candidate=${CAND.fresh}`);
    await expect(stateCard(page)).toBeVisible();
    texts.push(await main(page).innerText());
    for (const t of texts) expect(t, 'no sentence says the candidate is told').not.toMatch(TELLS_CANDIDATE);
    const app = new URL(page.url()).host;
    const stray = out.map((r) => new URL(r.url())).filter((u) => u.host !== app && !/fonts\.(googleapis|gstatic)\.com$/.test(u.host) && !/\/v1\/offers(\/|$)/.test(u.pathname) && !/\/v1\/company\/modules$/.test(u.pathname) && !shell.has(`${u.host}${u.pathname}`));
    expect(stray.map((u) => `${u.host}${u.pathname}`), 'no other request').toEqual([]);
  });
});

// ================================================================ AC-11 Company (rule 14, REC-UI-00 rule 9)
test.describe('AC-11 Company', () => {
  test.beforeEach(noBackendOnly);

  test('AC-11 No offers request carries a company id, a company key or a company header, through a whole draft, submit, approve, send and decline', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await page.goto(`/hire/offers/new?candidate=${CAND.fresh2}`);
    await field(page, W.salary).fill('650000');
    await fillDate(field(page, W.start), START);
    await fillDate(field(page, W.expires), EXPIRY);
    await btn(stateCard(page), W.save).click();
    await expect.poll(() => offers!.to('POST', /\/v1\/offers$/).length).toBe(1);
    await btn(stateCard(page), W.submit).click();
    await expect.poll(() => stateWord(page)).toBe('Waiting for approval');
    await openList(page);
    await openOffer(page, O.sent);
    await btn(main(page), W.show).click();
    await btn(stateCard(page), W.recordAnswer).click();
    await dialog(page).getByRole('radio', { name: 'Declined', exact: true }).dispatchEvent('click');
    await btn(dialog(page), W.recordAnswer).click();
    await expect.poll(() => stateWord(page)).toBe('Declined');
    const all = offers!.requests;
    expect(all.length).toBeGreaterThan(5);
    for (const c of all) expect(companyIdIn(c), `${c.method} ${c.path}`).toEqual([]);
    for (const c of all) expect(c.raw).not.toContain(COMPANY_ID.A);
  });

  test('AC-11 After A\'s Recruiter opens two offers and signs out with the app\'s own Sign out, B\'s Recruiter in the same browser opening those ids gets "This offer could not be found." and no trace of them (S6, lock check round 1)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, modules } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.sent);
    await openOffer(page, O.approved);
    // The app's own Sign out, not a test wipe: whatever the app keeps in the browser stays as the app leaves it.
    await page.getByRole('button', { name: /^Your account/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    modules!.answers.B = ['onboarding', 'recruitment'];
    await as(fx, P.recruiterB);
    for (const [id, name] of [[O.sent, NAMES.sent], [O.approved, NAMES.approved]] as const) {
      await page.goto(`/hire/offers/${id}`);
      await expect(main(page).getByText(W.notFound, { exact: true })).toBeVisible();
      await expect(stateCard(page)).toHaveCount(0);
      await quiet(page);
      expect(await page.content(), `${name} appears nowhere in the page`).not.toContain(name);
    }
  });

  test('AC-11 After A signs out with the app\'s Sign out and B signs in on the page the app left (no reload), B sees nothing of A: not in the Offers list while B\'s answer is on its way or after it, and not on A\'s offer id reached inside the app (S6 memory, lock check round 2)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, signIn, cognito, modules, hire, offers } = fx;
    const aNames = Object.entries(NAMES).filter(([k]) => k !== 'b').map(([, v]) => v);
    const noA = async (where: string) => {
      const html = await page.content();
      for (const n of aNames) expect(html, `${where}: ${n} (company A) appears`).not.toContain(n);
    };
    await as(fx, P.recruiter);
    await page.goto('/hire/offers');
    await expect(main(page).getByText(NAMES.sent)).toBeVisible();
    await main(page).getByRole('link', { name: NAMES.sent, exact: true }).click();
    await expect(stateCard(page)).toBeVisible();
    await page.getByRole('button', { name: /^Your account/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    // B (Recruitment on) signs in on the sign-in page the app left: no page.goto, so nothing the app keeps in memory is wiped.
    modules!.answers.B = ['onboarding', 'recruitment'];
    const who = P.recruiterB;
    if (cognito!.subOf(who.email) === undefined) cognito!.addAccount(who);
    modules!.assign(who.email, who.company);
    hire!.assign(who);
    offers!.assign(who);
    await signIn.signInAs(who);
    await expect(page).toHaveURL(who.lands!);
    // Offers from the side menu, with B's list answer held.
    offers!.refuse({ method: 'GET', path: /\/v1\/offers$/, hold: true });
    await openNav(page);
    await page.locator('pp-side-navigation a.pp-side-navigation__item[href="/hire/offers"]').filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/hire\/offers$/);
    await page.waitForTimeout(500);
    await noA('the list while B\'s answer is on its way');
    offers!.release();
    await expect(main(page).getByText(NAMES.b)).toBeVisible();
    await noA('the list after B\'s answer');
    // A's offer id reached inside the app, as the browser's Back button does: no reload.
    await page.evaluate((id) => { history.pushState({}, '', `/hire/offers/${id}`); dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, O.sent);
    await expect(main(page).getByText(W.notFound, { exact: true })).toBeVisible();
    await expect(stateCard(page)).toHaveCount(0);
    await noA('A\'s offer id');
  });

  test('AC-11 A Recruiter of company B (Recruitment switched on) opening A\'s offer gets "This offer could not be found."; B\'s list holds only B\'s offer', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, modules } = fx;
    modules!.answers.B = ['onboarding', 'recruitment'];
    await as(fx, P.recruiterB);
    await page.goto(`/hire/offers/${O.sent}`);
    await expect(main(page).getByText(W.notFound, { exact: true })).toBeVisible();
    await expect(stateCard(page)).toHaveCount(0);
    expect(await page.content()).not.toContain(NAMES.sent);
    await openList(page);
    expect((await rows(page)).map((r) => r['Candidate'])).toEqual([NAMES.b]);
  });
});

// ================================================================ AC-12 Phone (REC-UI-00 rule 4)
test.describe('AC-12 Phone', () => {
  test.beforeEach(noBackendOnly);
  test.beforeEach(() => phoneOnly('the criterion is the 390 wide screen'));

  async function everythingReachable(page: Page, where: string, scope = 'main'): Promise<void> {
    const problems = await page.evaluate(async (root) => {
      const out: string[] = [];
      const width = document.documentElement.clientWidth;
      const bar = root === 'main' ? document.querySelector('pp-top-navigation')?.getBoundingClientRect() : undefined;
      const sel = ['h1', 'h2', '[role="heading"]', 'button', 'a[href]', 'input', 'textarea', 'select', 'summary', 'th', 'td', 'label'].map((s) => `${root} ${s}`).join(',');
      const targets = [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert],[hidden],[aria-hidden="true"]') && !el.closest('.pp-visually-hidden') && !(el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'radio');
      });
      for (const el of targets) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = el.getBoundingClientRect();
        const label = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
        if (r.left < -1 || r.right > width + 1) out.push(`${label} is cut off sideways (${Math.round(r.left)} to ${Math.round(r.right)})`);
        if (bar && r.top < bar.bottom - 1 && r.bottom > 0) out.push(`${label} is under the top bar`);
        if (['TD', 'TH', 'LABEL'].includes(el.tagName)) continue;
        const x = Math.min(Math.max(r.left + r.width / 2, 1), width - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        if (hit && !el.contains(hit) && !hit.contains(el) && !(['INPUT', 'TEXTAREA'].includes(el.tagName) && hit.closest('label,.pp-field,.pp-text-field')?.contains(el))) out.push(`${label} is covered by ${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}`);
      }
      window.scrollTo(0, 0);
      if (document.documentElement.scrollWidth > width + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide)`);
      return out;
    }, scope);
    expect(problems, where).toEqual([]);
  }

  async function fullScreen(page: Page, where: string): Promise<void> {
    const vp = page.viewportSize()!;
    // Wait for the slide-in to finish: the box settles where the design system puts it.
    await expect.poll(async () => { const b = (await dialog(page).boundingBox())!; return [Math.round(b.x), Math.round(b.width)]; }, { message: `${where}: the full width` }).toEqual([0, vp.width]);
    const box = (await dialog(page).boundingBox())!;
    // D-T-04.10: below 768 the design system shows a dialog or drawer as a sheet from edge to edge, on the bottom of the screen.
    expect([Math.round(box.x), Math.round(box.width)], `${where}: the full width`).toEqual([0, vp.width]);
    expect(Math.abs(box.y + box.height - vp.height), `${where}: on the bottom edge`).toBeLessThanOrEqual(1);
  }

  test('AC-12 The Offers list at 390: everything reachable, not under the top bar, rows stacked, no sideways scroll', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    await as(fx, P.recruiter);
    await openList(page);
    await everythingReachable(page, 'Offers');
    await expect(table(page)).toHaveClass(/pp-table--stack/);
    const first = table(page).locator('tbody tr').first();
    const tops = await first.locator('td').evaluateAll((tds) => tds.filter((td) => (td as HTMLElement).getBoundingClientRect().height > 0).map((td) => Math.round(td.getBoundingClientRect().top)));
    expect(new Set(tops).size, 'the cells of a row stack').toBeGreaterThan(2);
  });

  for (const k of ['draft', 'sentBack', 'waiting', 'approved', 'sent', 'declined', 'expired'] as const) {
    test(`AC-12 The ${k} offer at 390: every heading, button, field and the accordion is reachable and not under the top bar`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
      const { page } = fx;
      await as(fx, k === 'waiting' ? P.approver : P.recruiter);
      await openOffer(page, O[k]);
      await everythingReachable(page, k);
    });
  }

  test('AC-12 The Withdraw dialog and the Record answer drawer fill the width at 390 (the design system sheet), with everything in them reachable', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.approved);
    await btn(stateCard(page), W.withdraw).click();
    await fullScreen(page, 'Withdraw this offer?');
    await everythingReachable(page, 'Withdraw dialog', ':is([role="dialog"], [role="alertdialog"])');
    await btn(dialog(page), W.cancel).click();
    await openOffer(page, O.sent);
    await btn(stateCard(page), W.recordAnswer).click();
    await fullScreen(page, 'Record answer');
    await everythingReachable(page, 'Record answer drawer', ':is([role="dialog"], [role="alertdialog"])');
  });
});

// ================================================================ AC-13 Kit match and words (REC-UI-00 rule 5)
test.describe('AC-13 Kit match and words', () => {
  test.beforeEach(noBackendOnly);

  const DS = join(__dirname, '..', '..', 'src', 'styles', 'design-system');
  const known = (): Set<string> => new Set(['components.css', 'tokens/base.css'].flatMap((f) => readFileSync(join(DS, f), 'utf8').match(/\.pp-[a-z0-9_-]+/g) ?? []).map((c: string) => c.slice(1)));
  type Screen = keyof typeof KIT.screens;
  const kit = (name: string) => (KIT.screens as Record<string, { main: readonly string[]; card?: readonly string[]; accordion?: readonly string[]; overlay?: readonly string[] }>)[phone() && !name.endsWith('(phone)') ? `${name} (phone)` : name]!;
  // Layout helpers, the kit's inline-frame classes, avatar colours; and parts this card does not build (interactions, Batsi, the record's tabs).
  const SKIP = [/^pp-gap-/, /^pp-inline/, /^pp-stack/, /--inline$/, /^pp-blanket--end$/, /^pp-avatar--(?!small)/, /^pp-text(--|$)/, /^pp-measure-/];

  async function classesOf(scope: Locator): Promise<Set<string>> {
    return new Set(await scope.evaluate((root) => [...new Set([root, ...root.querySelectorAll('*')].flatMap((el) => [...el.classList]).filter((c) => c.startsWith('pp-')))]));
  }
  function missing(kitList: readonly string[] | undefined, have: Set<string>, extra: RegExp[] = []): string[] {
    return (kitList ?? []).filter((c) => !have.has(c) && ![...SKIP, ...extra].some((re) => re.test(c)));
  }
  async function onlyPp(page: Page, where: string): Promise<void> {
    const have = known();
    const found = await main(page).evaluate((el) => ({
      classes: [...new Set([el, ...el.querySelectorAll('*')].flatMap((e) => [...e.classList]).filter((c) => c.startsWith('pp-')))],
      // Angular's own ng-* classes and the design system icons' lucide classes aside, every class is a design system one.
      other: [...new Set([...el.querySelectorAll('*')].flatMap((e) => [...e.classList]).filter((c) => !/^(pp-|ng-|lucide)/.test(c)))],
      styled: [...el.querySelectorAll('[style]')].filter((e) => !/^(--[\w-]+:[^;]*;?\s*)+$/.test(e.getAttribute('style') ?? '')).map((e) => e.tagName.toLowerCase()),
      styles: el.querySelectorAll('style').length,
      tags: [...new Set([...el.querySelectorAll('*')].map((e) => e.tagName.toLowerCase()).filter((t) => t.includes('-') && !t.startsWith('pp-') && !t.startsWith('app-') && t !== 'router-outlet'))],
    }));
    expect(found.classes.filter((c) => !have.has(c)), `${where}: every pp-* class exists in the design system`).toEqual([]);
    expect(found.other, `${where}: no class outside the design system`).toEqual([]);
    expect(found.styled, `${where}: no style attribute that sets a look`).toEqual([]);
    expect(found.styles, `${where}: no style element`).toBe(0);
    expect(found.tags, `${where}: no custom element but pp-* and app-*`).toEqual([]);
  }

  test('AC-13 The app stays synced at the design system ref the kit capture names; the K-1 screens were captured at DS PR 67', async () => {
    const sync = JSON.parse(readFileSync(join(DS, 'sync.json'), 'utf8')) as { ref: string };
    expect(sync.ref, 'a design system change needs these structures captured again (a child lock)').toBe(KIT.syncRef);
    expect(KIT.ref).toBe('5eed22cf6e234e4c1872f7d094839eba624d11dd');
  });

  test('AC-13 The Offers list matches the kit screen "Offers" and uses only design system parts', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    await as(fx, P.recruiter);
    await openList(page);
    expect(missing(kit('Offers').main, await classesOf(main(page))), 'classes the kit has and the page lacks').toEqual([]);
    await onlyPp(page, 'Offers');
  });

  const STATES: Array<[Screen, keyof typeof O, Who]> = [
    ['Candidate: offer, draft', 'sentBack', P.recruiter], ['Candidate: offer, waiting for approval', 'waiting', P.approver],
    ['Candidate: offer, waiting for approval (drafter)', 'waiting', P.recruiter], ['Candidate: offer, approved', 'approved', P.recruiter],
    ['Candidate: offer', 'sent', P.recruiter], ['Candidate: offer, accepted', 'accepted', P.recruiter], ['Candidate: offer, declined', 'declined', P.recruiter],
    ['Candidate: offer, expired', 'expired', P.recruiter], ['Candidate: offer, withdrawn', 'withdrawn', P.recruiter],
  ];
  for (const [screen, k, who] of STATES) {
    test(`AC-13 The ${k} offer matches the kit screen "${screen}": its state card and its accordion; only design system parts`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
      const { page } = fx;
      await as(fx, who);
      await openOffer(page, O[k]);
      const s = kit(screen);
      expect(missing(s.card, await classesOf(stateCard(page))), 'state card: classes the kit has and the card lacks').toEqual([]);
      if (s.accordion) expect(missing(s.accordion, await classesOf(main(page).locator('.pp-accordion').first())), 'accordion: classes the kit has and the page lacks').toEqual([]);
      await expect(main(page).locator('.pp-person-header'), 'the person header').toHaveCount(1);
      await onlyPp(page, k);
    });
  }

  test('AC-13 The Withdraw dialog matches "Withdraw this offer" (a danger modal dialog), and the Record answer drawer matches "Record answer" but for the Accepted parts', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.approved);
    await btn(stateCard(page), W.withdraw).click();
    expect(missing(kit('Withdraw this offer').overlay ?? KIT.screens['Withdraw this offer'].overlay, await classesOf(dialog(page)), [/^pp-blanket/]), 'Withdraw dialog').toEqual([]);
    await btn(dialog(page), W.cancel).click();
    await openOffer(page, O.sent);
    await btn(stateCard(page), W.recordAnswer).click();
    // Step A has no Accepted: the upload, the start date field and the "When you confirm" card come with step B (rec-ui-04.1).
    const later = [/^pp-file-upload$/, /^pp-card/, /^pp-text-field$/, /^pp-field__optional$/, /^pp-blanket/];
    expect(missing(KIT.screens['Record answer'].overlay, await classesOf(dialog(page)), later), 'Record answer drawer').toEqual([]);
  });

  test('AC-13 No offer page, dialog or drawer uses an old word: Masked, Rejected, Send off, Provisioning, Evaluation', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    const texts: string[] = [];
    await openList(page);
    texts.push(await main(page).innerText());
    for (const id of Object.values(O).filter((x) => x !== O.b)) { await openOffer(page, id); texts.push(await page.locator('body').innerText()); }
    offers!.refuse({ method: 'GET', path: /\/v1\/offers$/, status: 500 });
    await page.goto('/hire/offers');
    await expect(main(page).getByText(W.failed, { exact: true })).toBeVisible();
    texts.push(await main(page).innerText());
    for (const t of texts) expect(t).not.toMatch(NEVER);
  });
});

// ================================================================ AC-14 pepla-dev (the parts with no new seed)
test.describe('AC-14 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-14 runs on pepla-dev only.');

  test('AC-14 @pepla-dev The Recruiter opens Offers from the sidebar and the list loads (rows or "No one yet", never the failure line)', async ({ page, signIn, hr }) => {
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await openNav(page);
    await navItems(page).filter({ hasText: /^Offers$/ }).click();
    await expect(h1(page)).toHaveText(W.offers);
    await expect(table(page).or(main(page).getByText(W.empty, { exact: true }))).toBeVisible();
    await expect(main(page).getByText(W.failed, { exact: true })).toHaveCount(0);
  });

  test('AC-14 @pepla-dev An Employee has no Offers entry and /hire/offers sends them away', async ({ page, signIn, employee }) => {
    await signIn.open();
    await signIn.signInAs(employee);
    await expect(page).toHaveURL('/start');
    await openNav(page);
    expect(await navHeadings(page)).not.toContain('Hire');
    await page.goto('/hire/offers');
    await expect(page).not.toHaveURL(/\/hire\//);
  });
});
