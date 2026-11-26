import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page, Response } from '@playwright/test';
import { ON_DEV } from './support/fixtures';
import { forgetSignIn } from './support/sign-in-again';
import { navItems, navLabels, openNav } from './support/mod-02/shell-snapshot';
import { enter, quiet, type Who } from './support/rec-ui/harness';
import { KIT } from './support/rec-ui-04/kit';
import {
  BENEFITS, NOTE, O, P, START, W, cardActions, day, expect, field, fillDate, main, norm, openOffer, stateCard, test, type OffersFake,
} from './support/rec-ui-04/offers-fake';

/**
 * REC-UI-04 step A.2 · Offer screens: the real walk on pepla-dev, and three small fixes (Jira NH-230, epic NH-223, red).
 * Child lock acceptance-lock/rec-ui-04.2. Spec: onboarding-cards/specs/REC-UI-04.2.md (AC-14.1 to AC-14.6), its check
 * REC-UI-04.2-spec-check.md (rounds 1 and 2), decisions D-RUI-04.2a to f in onboarding-cards/DECISIONS.md. The parent spec
 * REC-UI-04.md (rules 1 to 14) wins where this one is silent. Notes and the test writer's choices: cards/rec-ui-04.2.md.
 *
 * A new file, so the locked rec-ui-04.spec.ts and its support files stay as they are (D-RUI-04.2c). It reads
 * support/rec-ui-04/offers-fake.ts and kit.ts, support/rec-ui/harness.ts, support/mod-02/shell-snapshot.ts and
 * support/sign-in-again.ts, and changes none of them.
 *
 * AC-14.1 and AC-14.2 run on pepla-dev only (@pepla-dev), once, at 1280. AC-14.3 to AC-14.5 run in the no-backend run at 1280
 * and 390. AC-14.6 (nothing else moves) is the locked rec-ui-04, rec-ui-01, rec-ui-02 and mod-02 files passing unchanged.
 * Page time in the no-backend run is 19 Nov 2026 10:00 in Johannesburg (the harness). No test calls Bedrock or any paid AI.
 */

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
/** Forgets the sign-in inside the same test, the way the locked rec-ui-04 AC-5 does in the no-backend run. */
async function signOutQuietly(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
}

/** The dt/dd pairs of the state card, in order (as the locked rec-ui-04 AC-6 and AC-8 read them). */
async function facts(page: Page): Promise<Array<[string, string]>> {
  return stateCard(page).locator('dl').first().evaluate((dl) => {
    const out: Array<[string, string]> = [];
    let k: string | null = null;
    for (const el of [...dl.children]) {
      const t = (el.textContent ?? '').replace(/[\s ]+/g, ' ').trim();
      if (el.tagName === 'DT') k = t;
      else if (el.tagName === 'DD' && k !== null) { out.push([k, t]); k = null; }
    }
    return out;
  });
}
/** The words of the state lozenge (kit: the lozenge in the card). */
const stateWord = async (page: Page) => norm(await stateCard(page).locator('.pp-lozenge').first().innerText());

/** One part of the accordion by its heading, opened first when shut. */
async function part(page: Page, heading: string): Promise<Locator> {
  const item = main(page).locator('details').filter({ has: page.locator('summary', { hasText: heading }) }).first();
  await expect(item, `the "${heading}" part`).toBeVisible();
  if ((await item.getAttribute('open')) === null) await item.locator('summary').click();
  return item;
}

/** Fields a person could type in, inside <main>. */
const typeable = (page: Page) => main(page).locator('input:not([type="hidden"]), textarea, select, [contenteditable=""], [contenteditable="true"]').filter({ visible: true });

/** Today in Johannesburg as the screens write it ("26 Nov 2026"). */
const todayJhb = () => day(new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10));
/** 480000 → "480 000.00" (the parent's money format, W-04 and AC-7). */
const money = (n: number) => { const [w, c] = n.toFixed(2).split('.'); return `${w!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${c}`; };
/** A token in local or session storage: the sign-in finished, wherever the app then sends the person. */
const JWT = /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*/;
async function hasToken(page: Page): Promise<boolean> {
  return page.evaluate((re) => {
    const r = new RegExp(re);
    for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) if (r.test(s.getItem(s.key(i) ?? '') ?? '')) return true;
    return false;
  }, JWT.source).catch(() => false);
}

// ================================================================ AC-14.3 Approver sees a sent-back Draft read only (N-1)
test.describe('AC-14.3 Approver sees a sent-back Draft read only', () => {
  test.beforeEach(noBackendOnly);

  const DS = join(__dirname, '..', '..', 'src', 'styles', 'design-system');
  const known = (): Set<string> => new Set(['components.css', 'tokens/base.css'].flatMap((f) => readFileSync(join(DS, f), 'utf8').match(/\.pp-[a-z0-9_-]+/g) ?? []).map((c: string) => c.slice(1)));
  const SKIP = [/^pp-gap-/, /^pp-inline/, /^pp-stack/, /--inline$/, /^pp-avatar--(?!small)/, /^pp-text(--|$)/, /^pp-measure-/];
  const phone = () => test.info().project.name === 'phone-390';
  const waitingAccordion = () => (KIT.screens as Record<string, { accordion?: readonly string[] }>)[`Candidate: offer, waiting for approval${phone() ? ' (phone)' : ''}`]?.accordion
    ?? (KIT.screens as Record<string, { accordion?: readonly string[] }>)['Candidate: offer, waiting for approval']!.accordion!;

  async function classesOf(scope: Locator): Promise<Set<string>> {
    return new Set(await scope.evaluate((root) => [...new Set([root, ...root.querySelectorAll('*')].flatMap((el) => [...el.classList]).filter((c) => c.startsWith('pp-')))]));
  }

  /** Everything AC-14.3 asks of the read-only Draft, for one person. */
  async function readOnlyDraft(page: Page, who: string): Promise<void> {
    await openOffer(page, O.sentBack);
    expect(await stateWord(page), `${who}: the state word`).toBe(W.states.DRAFT);
    const msg = stateCard(page).locator('.pp-section-message').filter({ hasText: W.sentBackBy('Sipho Ndlovu') });
    await expect(msg, `${who}: the sent-back note on the card`).toHaveCount(1);
    await expect(msg).toContainText(NOTE);
    // No input, text box or date field, and none of the Recruiter's actions.
    await expect(typeable(page), `${who}: nothing to type in`).toHaveCount(0);
    for (const role of ['textbox', 'spinbutton', 'combobox'] as const) await expect(main(page).getByRole(role), `${who}: no ${role}`).toHaveCount(0);
    for (const name of [W.save, W.submit, W.withdraw]) await expect(btn(page, name), `${who}: no "${name}"`).toHaveCount(0);
    expect(await cardActions(page), `${who}: no action on the card`).toEqual([]);
    // The layout every other state uses: person header, state card, then Offer details and Approval chain (S-2).
    const details = await part(page, W.details);
    const pairs = await details.locator('dl').first().evaluate((dl) => [...dl.querySelectorAll('dt')].map((dt) => [(dt.textContent ?? '').trim(), ((dt.nextElementSibling as HTMLElement | null)?.innerText ?? '').replace(/[\s ]+/g, ' ').trim()]));
    expect(pairs.map((p) => p[0]), `${who}: the details, kit order`).toEqual([W.role, W.department, W.salary, W.start, W.benefits]);
    expect(Object.fromEntries(pairs), `${who}: the details' values`).toMatchObject({ [W.role]: 'Fleet controller', [W.department]: 'Operations', [W.start]: day(START), [W.benefits]: BENEFITS });
    await expect(details.getByLabel(W.salaryHidden, { exact: true }), `${who}: Salary hidden`).toBeVisible();
    const chain = await part(page, W.chain);
    expect(norm(await chain.locator(':scope > :not(summary)').first().innerText()), `${who}: the chain while nobody has approved`).toBe(W.notYet);
    const order = await main(page).evaluate((m) => {
      const head = m.querySelector('.pp-person-header'), card = [...m.querySelectorAll('article, .pp-card')].find((a) => a.querySelector('h2')?.textContent?.trim() === 'Offer'), acc = m.querySelector('.pp-accordion');
      const pos = (a: Element | null | undefined, b: Element | null | undefined) => !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return [pos(head, card), pos(card, acc)];
    });
    expect(order, `${who}: person header, then the state card, then the accordion`).toEqual([true, true]);
    // AC-13's kit match, as for the other states: the accordion is the kit's, and only design system parts.
    const have = await classesOf(main(page).locator('.pp-accordion').first());
    expect(waitingAccordion().filter((c) => !have.has(c) && !SKIP.some((re) => re.test(c))), `${who}: accordion classes the kit has and the page lacks`).toEqual([]);
    const ds = known();
    const found = await main(page).evaluate((el) => ({
      classes: [...new Set([el, ...el.querySelectorAll('*')].flatMap((e) => [...e.classList]).filter((c) => c.startsWith('pp-')))],
      other: [...new Set([...el.querySelectorAll('*')].flatMap((e) => [...e.classList]).filter((c) => !/^(pp-|ng-|lucide)/.test(c)))],
    }));
    expect(found.classes.filter((c) => !ds.has(c)), `${who}: every pp-* class exists in the design system`).toEqual([]);
    expect(found.other, `${who}: no class outside the design system`).toEqual([]);
    expect(await page.content(), `${who}: no salary in the page`).not.toMatch(/650[\s ,]?000/);
  }

  for (const [who, label] of [[P.approver, 'the approver with the tick only'], [P.approverHr, 'HR with the approver tick and no Recruitment tick']] as const) {
    test(`AC-14.3 For ${label}, a sent-back Draft is read only: the Draft word and the note, then Offer details and Approval chain; no field and no Save draft, Submit for approval or Withdraw offer`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
      const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
      await as(fx, who);
      await readOnlyDraft(fx.page, who.full);
      expect(fx.offers!.requests.filter((c) => c.method !== 'GET'), 'nothing written').toEqual([]);
    });
  }

  test('AC-14.3 Decided by Recruiter access, never by drafted_by_me: the approver told "you drafted this" still sees it read only; a Recruiter (both ticks) told "not you" still gets the form', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    offers!.draftedByMe.set(O.sentBack, true);
    await as(fx, P.approver);
    await readOnlyDraft(page, 'the approver with drafted_by_me true');
    await signOutQuietly(page);
    // The guard on the fix: the Recruiter keeps the form on the same answer (rule 4), whatever drafted_by_me says.
    offers!.draftedByMe.set(O.sentBack, false);
    await as(fx, P.both);
    await openOffer(page, O.sentBack);
    expect(await stateWord(page)).toBe(W.states.DRAFT);
    for (const label of [W.salary, W.start, W.expires, W.benefits]) await expect(field(page, label), `the Recruiter's ${label} field`).toBeVisible();
    expect(await cardActions(page), 'the Recruiter\'s Draft actions').toEqual([W.save, W.submit, W.withdraw].sort());
  });
});

// ================================================================ AC-14.4 Any other 403 shows the generic line (N-2)
test.describe('AC-14.4 Any other 403', () => {
  test.beforeEach(noBackendOnly);

  /** The generic line exactly once on the page, and no drafter line. */
  async function genericOnce(page: Page, what: string): Promise<void> {
    await expect(page.getByText(W.generic, { exact: true }), `${what}: "${W.generic}" once`).toHaveCount(1);
    await expect(page.getByText(W.drafter, { exact: true }), `${what}: no drafter line`).toHaveCount(0);
  }

  test('AC-14.4 A 403 on Save draft shows the generic line once, keeps what was typed and shows no drafter line', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.draft);
    await field(page, W.benefits).fill('Typed before a 403');
    offers!.refuse({ method: 'PATCH', path: /\/v1\/offers\/[^/]+$/, status: 403, body: { error: 'Forbidden' } });
    await btn(stateCard(page), W.save).click();
    await expect.poll(() => offers!.to('PATCH', /\/v1\/offers\/[^/]+$/).length, 'the save was sent and refused').toBe(1);
    await genericOnce(page, 'Save draft');
    await expect(field(page, W.benefits), 'what was typed is kept').toHaveValue('Typed before a 403');
    expect(await stateWord(page)).toBe(W.states.DRAFT);
  });

  test('AC-14.4 A 403 on Submit for approval shows the generic line once, keeps what was typed and shows no drafter line', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.draft);
    await field(page, W.benefits).fill('Typed before a 403');
    offers!.refuse({ method: 'POST', path: /\/submit$/, status: 403, body: { error: 'Forbidden' } });
    await btn(stateCard(page), W.submit).click();
    await expect.poll(() => offers!.to('POST', /\/submit$/).length, 'the submit was sent and refused').toBe(1);
    await genericOnce(page, 'Submit for approval');
    await expect(field(page, W.benefits), 'what was typed is kept').toHaveValue('Typed before a 403');
    expect(await stateWord(page)).toBe(W.states.DRAFT);
  });

  test('AC-14.4 A 403 on Mark as sent shows the generic line once and no drafter line', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.approved);
    offers!.refuse({ method: 'POST', path: /\/send$/, status: 403, body: { error: 'Forbidden' } });
    await btn(stateCard(page), W.markSent).click();
    await expect.poll(() => offers!.to('POST', /\/send$/).length, 'the send was sent and refused').toBe(1);
    await genericOnce(page, 'Mark as sent');
    expect(await stateWord(page)).toBe(W.states.APPROVED);
  });

  test('AC-14.4 A 403 on Withdraw offer (a Waiting offer, a Recruiter who did not draft it) shows the generic line once and no drafter line; a 403 on Send back still shows the drafter line only', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    // Parent AC-5, unchanged: a 403 on Send back (as on Approve) means "you drafted it".
    await as(fx, P.approver);
    await openOffer(page, O.waiting);
    await stateCard(page).getByLabel(W.sendBackPrompt, { exact: true }).fill(NOTE);
    offers!.refuse({ method: 'POST', path: /\/send-back$/, status: 403, body: { error: 'Forbidden' } });
    await btn(stateCard(page), W.sendBack).click();
    await expect(main(page).getByText(W.drafter, { exact: true }), 'Send back 403: the drafter line').toHaveCount(1);
    await expect(page.getByText(W.generic, { exact: true }), 'Send back 403: not the generic line').toHaveCount(0);
    await signOutQuietly(page);
    // The fix: Withdraw is not an approver's action, so its 403 is "could not be saved".
    await as(fx, P.recruiter2);
    await openOffer(page, O.waiting);
    await expect(page.getByText(W.drafter, { exact: true }), 'not the drafter: no drafter line before').toHaveCount(0);
    offers!.refuse({ method: 'POST', path: /\/withdraw$/, status: 403, body: { error: 'Forbidden' } });
    await btn(stateCard(page), W.withdraw).click();
    await btn(dialog(page), W.withdraw).click();
    await expect.poll(() => offers!.to('POST', /\/withdraw$/).length, 'the withdraw was sent and refused').toBe(1);
    await genericOnce(page, 'Withdraw offer');
    expect(await stateWord(page)).toBe(W.states.WAITING_APPROVAL);
  });

  test('AC-14.4 A 403 on Record answer shows the generic line once and no drafter line', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
    const { page, offers } = fx;
    await as(fx, P.recruiter);
    await openOffer(page, O.sent);
    await btn(stateCard(page), W.recordAnswer).click();
    const d = dialog(page);
    await d.getByRole('radio', { name: 'Declined', exact: true }).dispatchEvent('click');
    offers!.refuse({ method: 'POST', path: /\/answer$/, status: 403, body: { error: 'Forbidden' } });
    await btn(d, W.recordAnswer).click();
    await expect.poll(() => offers!.to('POST', /\/answer$/).length, 'the answer was sent and refused').toBe(1);
    await genericOnce(page, 'Record answer');
    expect(await stateWord(page)).toBe(W.states.SENT);
  });
});

// ================================================================ AC-14.5 New offer with no candidate (N-5)
test.describe('AC-14.5 New offer with no candidate', () => {
  test.beforeEach(noBackendOnly);

  for (const [label, url] of [['no ?candidate=', '/hire/offers/new'], ['an empty ?candidate=', '/hire/offers/new?candidate=']] as const) {
    test(`AC-14.5 /hire/offers/new with ${label} shows "${W.notFound}" and makes no POST /v1/offers, even after a press on every button the page shows`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o }) => {
      const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, offers: _o };
      const { page, offers } = fx;
      await as(fx, P.recruiter);
      await page.goto(url);
      await expect(main(page).getByText(W.notFound, { exact: true })).toBeVisible();
      await expect(stateCard(page), 'no offer card').toHaveCount(0);
      await expect(typeable(page), 'no form').toHaveCount(0);
      const buttons = main(page).getByRole('button').filter({ visible: true });
      for (let i = 0; i < await buttons.count(); i++) {
        const b = buttons.nth(i);
        if (await b.isEnabled().catch(() => false)) await b.click({ timeout: 2_000 }).catch(() => undefined);
        await quiet(page);
      }
      await quiet(page);
      expect(offers!.to('POST', /\/v1\/offers$/), 'no POST /v1/offers').toEqual([]);
      expect(offers!.requests.filter((c) => c.method !== 'GET'), 'nothing written at all').toEqual([]);
    });
  }
});

// ================================================================ AC-14.1 and AC-14.2 on pepla-dev (judged after merge)
test.describe('AC-14.1 and AC-14.2 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-14.1 and AC-14.2 run on pepla-dev only.');

  const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-ui-04', 'dev-ids.json'), 'utf8')) as { candidate: string; firstName: string; lastName: string; salary: number; startDate: string; expiryDate: string };
  const env = (k: string) => process.env[k] ?? '';
  /** The app's own address on pepla-dev (CloudFront). REC-05 AC-11 uses the same. */
  const DEV_SITE = 'https://df2hrxausiknc.cloudfront.net';

  test('AC-14.1 @pepla-dev The real walk: the Recruiter drafts and submits for the seeded candidate (drafter line, no Approve); the approver opens it from Offers, shows the salary and approves; the Recruiter marks it as sent and withdraws it', async ({ page, signIn, hr }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at 1280 (the parent AC-14 covers the phone).');
    test.setTimeout(6 * 60_000);
    const approver = { email: env('E2E_APPROVER_EMAIL'), password: env('E2E_APPROVER_PASSWORD') };
    expect(approver.email && approver.password, 'the approver test login is set (E2E_APPROVER, load-e2e-logins.py)').toBeTruthy();
    const name = `${ids.firstName} ${ids.lastName}`;
    // The date the server stamps is today in Johannesburg; read before and after, so a walk over midnight still passes.
    const firstDay = todayJhb();
    const isToday = (d: string | undefined) => !!d && (d === firstDay || d === todayJhb());

    // The Recruiter drafts, saves and submits.
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto(`/hire/offers/new?candidate=${ids.candidate}`);
    await expect(field(page, W.salary)).toBeVisible();
    await field(page, W.salary).fill(String(ids.salary));
    await fillDate(field(page, W.start), ids.startDate);
    await fillDate(field(page, W.expires), ids.expiryDate);
    const made = page.waitForResponse((r: Response) => r.request().method() === 'POST' && /\/v1\/offers$/.test(new URL(r.url()).pathname));
    await btn(stateCard(page), W.save).click();
    const createdAnswer = await made;
    expect([200, 201], `Save draft makes the offer (${createdAnswer.status()})`).toContain(createdAnswer.status());
    const offerId = ((await createdAnswer.json()) as { offer_id?: string }).offer_id ?? '';
    expect(offerId, 'the new offer\'s id').toMatch(/^offer-/);
    await expect.poll(() => stateWord(page)).toBe(W.states.DRAFT);
    await btn(stateCard(page), W.submit).click();
    await expect.poll(() => stateWord(page), { timeout: 20_000 }).toBe(W.states.WAITING_APPROVAL);
    await expect(stateCard(page).getByText(W.drafter, { exact: true }), 'the drafter line').toBeVisible();
    const acts = await cardActions(page);
    expect(acts, 'the drafter has no Approve').not.toContain(W.approve);
    expect(acts, 'nor Send back').not.toContain(W.sendBack);
    testInfo.annotations.push({ type: 'offer', description: offerId });

    // The approver (approver tick only) opens Offers from the sidebar and the seed candidate's Waiting row.
    await forgetSignIn(page);
    await signIn.open();
    await signIn.signInAs(approver);
    await expect.poll(() => hasToken(page), { message: 'the approver is signed in', timeout: 20_000 }).toBe(true);
    await quiet(page);
    // This login holds no role, so the app may have no first page for it (it can stay on /sign-in): reach the shell through Offers.
    if (!(await page.locator('pp-top-navigation').isVisible())) await page.goto('/hire/offers');
    await openNav(page);
    expect(await navLabels(page), 'Offers is in the approver\'s sidebar').toContain(W.offers);
    await navItems(page).filter({ hasText: /^Offers$/ }).click();
    await expect(h1(page)).toHaveText(W.offers);
    const row = table(page).locator('tbody tr').filter({ hasText: name }).filter({ hasText: W.states.WAITING_APPROVAL });
    await expect(row, `one row of ${name} in Waiting for approval`).toHaveCount(1);
    await row.getByRole('link', { name, exact: true }).click();
    await expect(page, 'it is this run\'s offer').toHaveURL(new RegExp(`/hire/offers/${offerId}$`));
    await expect(main(page).getByLabel(W.salaryHidden, { exact: true }), 'the salary is hidden').toBeVisible();
    expect(norm(await main(page).innerText()), 'and not on the page').not.toContain(money(ids.salary));
    await btn(main(page), W.show).click();
    await expect.poll(async () => norm(await main(page).innerText()), { message: '"Show" shows the value it was given' }).toContain(money(ids.salary));
    await btn(stateCard(page), W.approve).click();
    await expect.poll(() => stateWord(page), { timeout: 20_000 }).toBe(W.states.APPROVED);
    const approved = (await facts(page))[0];
    expect(approved?.[0], 'the card reads Approved').toBe('Approved');
    expect(isToday(approved?.[1]), `with today's date (${approved?.[1]})`).toBe(true);

    // The Recruiter opens it again, marks it as sent, then withdraws it (this also frees the candidate for the next run).
    await forgetSignIn(page);
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await openOffer(page, offerId);
    expect(await stateWord(page)).toBe(W.states.APPROVED);
    await btn(stateCard(page), W.markSent).click();
    await expect.poll(() => stateWord(page), { timeout: 20_000 }).toBe(W.states.SENT);
    const sent = (await facts(page))[0];
    expect(sent?.[0], 'the card reads Sent').toBe(W.sentOn);
    expect(isToday(sent?.[1]), `with its sent date, today (${sent?.[1]})`).toBe(true);
    await btn(stateCard(page), W.withdraw).click();
    await expect(dialog(page).getByRole('heading', { name: W.withdrawTitle, exact: true })).toBeVisible();
    await btn(dialog(page), W.withdraw).click();
    await expect.poll(() => stateWord(page), { timeout: 20_000 }).toBe(W.states.WITHDRAWN);
    const gone = (await facts(page))[0];
    expect(gone?.[0], 'the card reads Withdrawn').toBe(W.states.WITHDRAWN);
    expect(isToday(gone?.[1]), `with today's date (${gone?.[1]})`).toBe(true);
  });

  test('AC-14.2 @pepla-dev Real preflights for PATCH with idempotency-key pass; company B\'s HR login typing an offer address of company A sees "This offer could not be found." if B has Offers, or is sent away if not; nothing of A either way', async ({ page, signIn, hr }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at 1280.');
    test.setTimeout(4 * 60_000);
    const b = { email: env('E2E_HR_B_EMAIL'), password: env('E2E_HR_B_PASSWORD') };
    expect(b.email && b.password, 'company B\'s HR test login is set (E2E_HR_B, load-e2e-logins.py)').toBeTruthy();
    // Any company A offer does (spec check round 2): REC-05's seeded draft, put back on every run, so this test needs no other test first.
    const rec05 = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-05', 'dev-ids.json'), 'utf8')) as { draftOffer: string; startDate: string; expiryDate: string };
    const offerId = rec05.draftOffer;
    const A_NAME = 'Rec Seed-Draft';

    // Real preflights (NH-187 lesson): from the dev site and from the address under test, PATCH with idempotency-key.
    const envFile = readFileSync(join(__dirname, '..', '..', 'src', 'environments', 'environment.ts'), 'utf8');
    const api = (/talentFlowApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(envFile)?.[1] ?? '').replace(/\/+$/, '').replace(/\/v1$/, '');
    expect(api, 'pepla-web\'s talentFlowApiUrl is the dev TalentFlow API').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const under = new URL(String(testInfo.project.use.baseURL ?? process.env['E2E_BASE_URL'] ?? 'http://127.0.0.1:4300')).origin;
    for (const origin of [...new Set([DEV_SITE, under])]) {
      const pre = await page.request.fetch(`${api}/v1/offers/${offerId}`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key' } });
      expect(pre.status(), `${origin}: the preflight passes`).toBeLessThan(300);
      const h = pre.headers();
      expect([origin, '*'], `${origin}: the origin is allowed`).toContain(h['access-control-allow-origin'] ?? '');
      expect((h['access-control-allow-methods'] ?? '').toUpperCase(), `${origin}: PATCH is allowed`).toContain('PATCH');
      expect((h['access-control-allow-headers'] ?? '').toLowerCase(), `${origin}: idempotency-key is allowed`).toContain('idempotency-key');
    }

    // The address is real: company A's Recruiter opens it.
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await openOffer(page, offerId);
    await expect(h1(page), 'company A sees its offer at this address').toHaveText(A_NAME);
    await forgetSignIn(page);

    // Company B. Whether B has Recruitment is read from B's own sidebar at run time, as REC-UI-02 record AC-R15 does.
    await signIn.open();
    await signIn.signInAs(b);
    await expect(page).toHaveURL('/hr');
    await openNav(page);
    const offersOn = (await navLabels(page)).includes(W.offers);
    testInfo.annotations.push({ type: 'company B', description: offersOn ? 'has Offers: not found expected' : 'has no Offers: sent away expected' });
    const reads: Array<{ path: string; status: number }> = [];
    page.on('response', (r) => { const u = new URL(r.url()); if (/\/v1\/offers(\/|$)/.test(u.pathname)) reads.push({ path: u.pathname, status: r.status() }); });
    await page.goto(`/hire/offers/${offerId}`);
    await quiet(page);
    if (offersOn) {
      await expect(main(page).getByText(W.notFound, { exact: true })).toBeVisible();
      await expect(stateCard(page)).toHaveCount(0);
    } else {
      await expect(page, 'sent away by the Offers guard').not.toHaveURL(/\/hire\/offers/);
    }
    const html = await page.content();
    for (const x of [A_NAME, 'Seed-Draft', 'Demo role', '350 000', '350000', day(rec05.startDate), day(rec05.expiryDate)]) expect(html, `nothing of A: ${x}`).not.toContain(x);
    expect(reads.filter((r) => r.path.includes(offerId) && r.status >= 200 && r.status < 300), 'no successful read of A\'s offer').toEqual([]);
  });
});
