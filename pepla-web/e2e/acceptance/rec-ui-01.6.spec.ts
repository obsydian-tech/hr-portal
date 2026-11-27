import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page, Request } from '@playwright/test';
import type { SignInPage } from './support/fixtures';
import { ON_DEV, ON_SIGN_IN, expectNoSession } from './support/fixtures';
import { forgetSignIn } from './support/sign-in-again';
import { card, firstName, readBoard, showStage } from './support/ang-01/gallery';
import { WHO, enter, expect, quiet, signInAs, test, watchErrors, type HireFake, type Who } from './support/rec-ui/harness';
import type { CognitoFake } from './support/cognito-fake';
import type { ModulesFake } from './support/mod-02/modules-fake';

/**
 * REC-UI-01.6 · Roles and hiring board leftovers (Jira NH-291, split from NH-227, amber). Lock `acceptance-lock/rec-ui-01.6`.
 * Spec: onboarding-cards/specs/REC-UI-01.6.md (rules 1 to 4, AC-14 to AC-20) over the parent REC-UI-01.md. Decisions D-RUI-01.6a to g
 * (onboarding-cards/DECISIONS.md). Notes: cards/rec-ui-01.6.md. Review page: onboarding-cards/specs/REC-UI-01.6-tests-for-review.md.
 *
 * This file holds AC-16 to AC-19. AC-14 is in rec-15.spec.ts (child lock rec-15.1) and rec-15b.spec.ts (child lock rec-15b.4); AC-15 is the
 * parked test of rec-ui-01.spec.ts, switched back on in this lock; AC-20 is the older suites, read on the build.
 *
 * The no-backend tests use the shared fake (support/rec-ui/harness.ts). Its list now sends `not_hired_pending` exactly as REC-UI-01.6 rule 1
 * says (this lock's change to the harness), and nothing more. A waiting decision lives on the fake server (`Cand.pending`), so a reload
 * reads it from the list, never from the page's memory.
 *
 * Words: only the parent's and the approved lines (no new words): "{name} must confirm before this is final.", "An HR person must confirm
 * before this is final.", "This account can't use Naleko People yet. Ask your HR team.", "Not hired", "Cancel".
 *
 * Pinned where the spec is silent (also in cards/rec-ui-01.6.md):
 *  - T-1 After a reload a waiting card's More actions offers exactly "Not hired" then "Cancel", as it does right after recording (AC-6).
 *  - T-2 A row whose personId names nobody the page knows shows no "must confirm" line at all (D-T-A12), and still offers Cancel.
 *  - T-3 AC-17's drag is tried two ways at 390: a mouse-style pointer drag and a touch drag (Chrome's touch events), each down, across
 *    the screen and down, up. Neither may send any request that changes something, open a dialog or change the board.
 *  - T-4 AC-18 runs the same steps in the no-backend run against the sign-in fake (the hiring manager of the harness, group manager),
 *    so the refusal is proved before merge too; the @pepla-dev test is the one judged after merge.
 *  - T-5 AC-18 "no request": no request of any host whose path holds /v1/roles or /v1/candidates, from before the sign-in page opens to
 *    the last step. "No token": no localStorage or sessionStorage key starting "CognitoIdentityServiceProvider.", and no token anywhere
 *    the browser keeps one (expectNoSession).
 *  - T-6 AC-19 reads the seeded ids from support/rec-ui-01.6/dev-ids.json (written by seed-dev.py's seed_recui01_6), runs at 1280 only,
 *    once per run, so one seeded candidate is enough (the per-width lesson of INT-UI-02/03 does not apply: no phone half).
 */

const phone = () => test.info().project.name === 'phone-390';
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');

const must = (name: string) => `${name} must confirm before this is final.`;
const HR_MUST = 'An HR person must confirm before this is final.'; // Iggie's words, 24 Nov 2026 (U-3)
const NO_ACCESS = "This account can't use Naleko People yet. Ask your HR team."; // auth.messages.ts, ONB-23
const SAVE_FAIL = 'Your change could not be saved. Try again.';

type Fx = { page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null };

const main = (page: Page): Locator => page.locator('main');
const h1 = (page: Page): Locator => page.locator('main h1').first();
const cardMore = (scope: Locator, name: string) => scope.getByRole('button', { name: `More actions for ${firstName(name)}`, exact: true });
const notHiredCalls = (hire: HireFake) => hire.to('POST', /\/not-hired(\/confirm|\/cancel)?$/);
const short = (path: string) => path.replace(/^.*\/v1\//, '/v1/');

async function openBoard(page: Page, role = 'role-fleet', title = 'Fleet controller'): Promise<Locator> {
  await page.goto(`/hire/pipeline?role=${role}&view=board`);
  await expect(h1(page)).toHaveText(title);
  await expect(main(page).locator('.pp-pipeline').first()).toBeVisible();
  return main(page);
}

/** Where every card is: stage name to names, whatever the width shows (a phone shows one stage at a time). */
async function boardNow(scope: Locator): Promise<Record<string, string[]>> {
  const picker = scope.getByLabel('Stage', { exact: true });
  if (await picker.isVisible()) {
    const out: Record<string, string[]> = {};
    for (const t of await picker.locator('option').allTextContents()) {
      const stage = t.replace(/\s*\(\d+\)\s*$/, '').trim();
      await showStage(scope, stage);
      out[stage] = (await readBoard(scope)).find((c) => c.stage === stage)?.cards ?? [];
    }
    return out;
  }
  return Object.fromEntries((await readBoard(scope)).map((c) => [c.stage, c.cards]));
}
const FLEET_AT_START = { Applied: ['Amahle Dlamini'], Screening: ['Tariro Moyo', 'Ayanda Mkhize'], Interview: ['Bongani Mthembu', 'Tendai Ncube'], Offer: ['Kagiso Molefe'], Hired: [] as string[] };

/** The items of a card's More actions, read with the menu open, then the menu is closed again with Escape. */
async function moreItems(page: Page, scope: Locator, name: string): Promise<string[]> {
  await cardMore(scope, name).click();
  const items = page.getByRole('menuitem');
  await expect(items.first()).toBeVisible();
  const words = (await items.allTextContents()).map((t) => t.trim());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem')).toHaveCount(0);
  return words;
}

/**
 * Everything a person can read on the board and in any dialog. The page header is left out: its "Hiring manager {name}" line is the
 * parent card's (on dev the role answer carries no name, so it reads "Hiring manager undefined" today; reported, not this card's).
 */
async function pageText(page: Page): Promise<string> {
  return `${(await main(page).locator('.pp-pipeline').first().textContent()) ?? ''} ${(await page.getByRole('dialog').allTextContents()).join(' ')}`;
}

/** Records Not hired on a card ("Not the right skills") and waits for the one POST. */
async function recordNotHired(fx: Fx, scope: Locator, name: string, stage: string): Promise<void> {
  await showStage(scope, stage);
  await cardMore(scope, name).click();
  await fx.page.getByRole('menuitem', { name: 'Not hired', exact: true }).click();
  const d = fx.page.getByRole('dialog', { name: `${firstName(name)} not hired`, exact: true });
  await expect(d).toBeVisible();
  await d.getByRole('radio', { name: 'Not the right skills', exact: true }).check();
  await d.getByRole('button', { name: 'Record not hired', exact: true }).click();
  await expect.poll(() => notHiredCalls(fx.hire!).length).toBe(1);
  if (await d.isVisible()) await d.getByRole('button', { name: /^(Cancel|Close)$/ }).first().click();
  await expect(fx.page.getByRole('dialog')).toHaveCount(0);
}

/** After a reload: the card is in its column with exactly `line` (or no "must confirm" line when `line` is null), and nothing is final. */
async function stillWaiting(fx: Fx, name: string, stage: string, line: string | null): Promise<Locator> {
  const scope = main(fx.page);
  await expect(h1(fx.page)).toHaveText('Fleet controller');
  await showStage(scope, stage);
  const c = card(scope, name);
  await expect(c, `${name} is still in ${stage}`).toHaveCount(1);
  if (line) {
    await expect(c.getByText(line, { exact: true }), 'the card carries the line').toBeVisible();
    expect(((await c.textContent()) ?? '').split(line).join(' '), 'and no other "must confirm" line').not.toContain('must confirm');
  }
  const text = await pageText(fx.page);
  if (!line) expect(text, 'no "must confirm" line anywhere').not.toContain('must confirm');
  expect(text, 'no empty name, "undefined" or "null"').not.toMatch(/undefined|null|\s{2}must confirm|^must confirm/);
  await expect(scope.getByRole('button', { name: 'Not hired 2', exact: true }), 'nothing is final yet').toBeVisible();
  return scope;
}

/** Cancel on the card's More actions: exactly one POST .../not-hired/cancel, answered 200, and the line goes; the card stays. */
async function cancelOnCard(fx: Fx, scope: Locator, name: string, stage: string): Promise<void> {
  const before = fx.hire!.to('POST', /\/not-hired\/cancel$/).length;
  await showStage(scope, stage);
  await cardMore(scope, name).click();
  await fx.page.getByRole('menuitem', { name: 'Cancel', exact: true }).click();
  await expect.poll(() => fx.hire!.to('POST', /\/not-hired\/cancel$/).length).toBe(before + 1);
  await quiet(fx.page);
  const sent = fx.hire!.to('POST', /\/not-hired\/cancel$/).slice(before);
  expect(sent.map((x) => `${short(x.path)} ${x.status}`), 'exactly one cancel, answered 200').toEqual([`/v1/candidates/${fx.hire!.world.cands.find((c) => c.name === name)!.id}/not-hired/cancel 200`]);
  await showStage(scope, stage);
  await expect(card(scope, name)).not.toContainText('must confirm');
  expect((await boardNow(scope))[stage], 'the card stays in its column').toContain(name);
  expect(fx.hire!.world.cands.find((c) => c.name === name)!.pending, 'the server let it go').toBeUndefined();
}

// ================================================================ AC-16 The waiting state survives a reload
test.describe('REC-UI-01.6 AC-16 The waiting state survives a reload', () => {
  test.beforeEach(noBackendOnly);

  test('AC-16 A decision waiting for the hiring manager: after a reload the card is still in Interview with "{name} must confirm before this is final.", More actions offers Not hired and Cancel, and Cancel sends one cancel and takes the line away', async ({ page, signIn, cognito, modules, hire }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire };
    const errors = watchErrors(page);
    hire!.secondConfirmation.add('cand-bongani');
    // As on dev, the role answer carries the hiring manager's id but not the name: the name comes from the company's hiring managers.
    delete (hire!.world.roles.find((r) => r.role_id === 'role-fleet') as { hiring_manager_name?: string }).hiring_manager_name;
    await enter(page, signIn, cognito, modules, hire, WHO.recruiterA);
    const scope = await openBoard(page);
    await recordNotHired(fx, scope, 'Bongani Mthembu', 'Interview');
    expect(notHiredCalls(hire!)[0]!.status, 'the fake answered pending, waiting on the role\'s hiring manager').toBe(200);
    const listsBefore = hire!.to('GET', /\/v1\/candidates$/).length;
    await page.reload();
    const after = await stillWaiting(fx, 'Bongani Mthembu', 'Interview', must('Sipho Ndlovu'));
    expect(hire!.to('GET', /\/v1\/candidates$/).length, 'the page read the list again after the reload').toBeGreaterThan(listsBefore);
    await expect(card(after, 'Tendai Ncube'), 'only the waiting card carries a line').not.toContainText('must confirm');
    expect(await moreItems(page, after, 'Bongani Mthembu'), 'More actions: Not hired and Cancel (T-1)').toEqual(['Not hired', 'Cancel']);
    expect(await moreItems(page, after, 'Tendai Ncube'), 'a card with nothing waiting: Not hired only').toEqual(['Not hired']);
    await cancelOnCard(fx, after, 'Bongani Mthembu', 'Interview');
    // And the line stays gone after another reload: the server let the decision go, and the list says so.
    await page.reload();
    await expect(h1(page)).toHaveText('Fleet controller');
    await showStage(main(page), 'Interview');
    await expect(card(main(page), 'Bongani Mthembu')).not.toContainText('must confirm');
    expect(await moreItems(page, main(page), 'Bongani Mthembu'), 'nothing waits: Not hired only').toEqual(['Not hired']);
    expect(errors, 'no console error').toEqual([]);
  });

  test('AC-16 A decision waiting for any HR person: after a reload the card shows "An HR person must confirm before this is final." and names nobody; Cancel sends one cancel and takes the line away', async ({ page, signIn, cognito, modules, hire }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire };
    const errors = watchErrors(page);
    hire!.secondConfirmationByHr.add('cand-bongani');
    await enter(page, signIn, cognito, modules, hire, WHO.recruiterA);
    const scope = await openBoard(page);
    await recordNotHired(fx, scope, 'Bongani Mthembu', 'Interview');
    await page.reload();
    const after = await stillWaiting(fx, 'Bongani Mthembu', 'Interview', HR_MUST);
    const text = await pageText(page);
    expect(text.split(HR_MUST).join(' '), 'no other "must confirm" line: nobody is named').not.toContain('must confirm');
    for (const n of ['Sipho', 'Farai', 'Precious']) expect(text, `no hiring manager (${n}) is named`).not.toContain(n);
    expect(await moreItems(page, after, 'Bongani Mthembu'), 'More actions: Not hired and Cancel (T-1)').toEqual(['Not hired', 'Cancel']);
    await cancelOnCard(fx, after, 'Bongani Mthembu', 'Interview');
    expect(errors, 'no console error').toEqual([]);
  });

  test('AC-16 A waiting decision whose person id names nobody the page knows: no line and no empty or guessed name, but Cancel is offered and works', async ({ page, signIn, cognito, modules, hire }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire };
    // Recorded by another Recruiter before this page opened; it waits for a person who is neither the role's manager nor in the list.
    const c = hire!.world.cands.find((x) => x.id === 'cand-bongani')!;
    c.pending = { by: WHO.recruiter2A.email, reason: 'NOT_RIGHT_SKILLS', awaiting: { kind: 'HIRING_MANAGER', personId: 'hm-gone-0042' } };
    await enter(page, signIn, cognito, modules, hire, WHO.recruiterA);
    await openBoard(page);
    const scope = await stillWaiting(fx, 'Bongani Mthembu', 'Interview', null);
    const text = await pageText(page);
    for (const n of ['Sipho', 'Farai', 'Precious', 'Naledi', 'Thandi', 'hm-gone']) expect(text, `no name is guessed (${n})`).not.toContain(n);
    expect(await moreItems(page, scope, 'Bongani Mthembu'), 'the decision is still waiting: Not hired and Cancel').toEqual(['Not hired', 'Cancel']);
    await cancelOnCard(fx, scope, 'Bongani Mthembu', 'Interview');
  });

  test('AC-16 A decision recorded by someone else before the page opened shows on the first load, for the role\'s manager by name and for HR, at once', async ({ page, signIn, cognito, modules, hire }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire };
    const w = hire!.world.cands;
    w.find((x) => x.id === 'cand-bongani')!.pending = { by: WHO.recruiter2A.email, reason: 'NOT_RIGHT_SKILLS', awaiting: { kind: 'HIRING_MANAGER', personId: 'hm-sipho' } };
    w.find((x) => x.id === 'cand-tendai')!.pending = { by: WHO.recruiter2A.email, reason: 'OTHER', awaiting: { kind: 'HR' } };
    await enter(page, signIn, cognito, modules, hire, WHO.recruiterA);
    const scope = await openBoard(page);
    await showStage(scope, 'Interview');
    await expect(card(scope, 'Bongani Mthembu').getByText(must('Sipho Ndlovu'), { exact: true })).toBeVisible();
    await expect(card(scope, 'Tendai Ncube').getByText(HR_MUST, { exact: true })).toBeVisible();
    expect((await boardNow(scope))['Interview'], 'both stay in Interview').toEqual(['Bongani Mthembu', 'Tendai Ncube']);
    await expect(scope.getByRole('button', { name: 'Not hired 2', exact: true }), 'nothing is final').toBeVisible();
    expect(notHiredCalls(fx.hire!), 'the page sent nothing to know it').toHaveLength(0);
  });

  test('AC-16 Company B: a Recruiter of B opening A\'s board sees nothing of A\'s waiting decision', async ({ page, signIn, cognito, modules, hire }) => {
    hire!.world.cands.find((x) => x.id === 'cand-bongani')!.pending = { by: WHO.recruiterA.email, reason: 'NOT_RIGHT_SKILLS', awaiting: { kind: 'HIRING_MANAGER', personId: 'hm-sipho' } };
    await enter(page, signIn, cognito, modules, hire, WHO.recruiterB);
    // B has the Recruitment module only in the harness's company C setup if at all; whatever B lands on, A's board shows nothing of A.
    await page.goto('/hire/pipeline?role=role-fleet&view=board');
    await quiet(page);
    const text = `${(await page.locator('body').textContent()) ?? ''}`;
    for (const v of ['Bongani', 'Sipho Ndlovu', 'must confirm', 'Fleet controller']) expect(text, `"${v}" of A is not on B's page`).not.toContain(v);
    for (const call of hire!.calls.filter((x) => x.company === 'B')) expect(call.raw, `${call.method} ${short(call.path)}: B's request names nothing of A`).not.toMatch(/cand-bongani|hm-sipho/);
    expect(hire!.calls.filter((x) => x.company === 'B' && /\/not-hired/.test(x.path)), 'B sends no Not hired request').toEqual([]);
  });
});

// ================================================================ AC-17 Phone drag does nothing
test.describe('REC-UI-01.6 AC-17 Phone drag does nothing', () => {
  test.beforeEach(noBackendOnly);
  test.beforeEach(() => test.skip(!phone(), 'Phone only: at 390 the board shows one stage at a time, and Move is the way (parent AC-10).'));

  test('AC-17 At 390 wide a drag on a card (down, across, up), by pointer and by touch, sends no stage request, opens no dialog and leaves the board as it was', async ({ page, signIn, cognito, modules, hire }) => {
    const errors = watchErrors(page);
    await enter(page, signIn, cognito, modules, hire, WHO.recruiterA);
    const scope = await openBoard(page);
    expect(await boardNow(scope), 'the board at the start').toEqual(FLEET_AT_START);
    const changes = () => hire!.calls.filter((x) => x.method !== 'GET').map((x) => `${x.method} ${short(x.path)}`);
    const before = changes();
    for (const [stage, name] of [['Interview', 'Bongani Mthembu'], ['Screening', 'Tariro Moyo'], ['Applied', 'Amahle Dlamini']] as const) {
      await showStage(scope, stage);
      const c = card(scope, name);
      await c.scrollIntoViewIfNeeded();
      const b = (await c.boundingBox())!;
      const [x, y] = [b.x + b.width / 2, b.y + b.height / 2];
      const vw = page.viewportSize()!.width;
      // Pointer drag: down, across the screen to the right edge and back to the left, down the page, up.
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 12, y + 4, { steps: 4 });
      await page.mouse.move(vw - 4, y + 40, { steps: 15 });
      await page.mouse.move(4, y + 160, { steps: 15 });
      await page.mouse.up();
      await quiet(page);
      // Touch drag (Chrome's touch events), the way a finger moves on a phone.
      const cdp = await page.context().newCDPSession(page);
      const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', px: number, py: number) =>
        cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: px, y: py }] });
      await touch('touchStart', x, y);
      for (let i = 1; i <= 20; i++) await touch('touchMove', x + ((vw - 4 - x) * i) / 20, y + 8 * i);
      for (let i = 1; i <= 20; i++) await touch('touchMove', vw - 4 - ((vw - 8) * i) / 20, y + 160 + 4 * i);
      await touch('touchEnd', 4, y + 240);
      await cdp.detach();
      await quiet(page);
      await expect(page.getByRole('dialog'), `${name}: no dialog opened`).toHaveCount(0);
      expect(hire!.to('PUT', /\/stage$/), `${name}: no stage request`).toHaveLength(0);
      expect(changes(), `${name}: no request that changes anything`).toEqual(before);
    }
    expect(await boardNow(scope), 'the board is as it was').toEqual(FLEET_AT_START);
    await expect(page.getByText(SAVE_FAIL, { exact: true }), 'no save failure shown').toHaveCount(0);
    // The Move button is still the way on a phone.
    await showStage(scope, 'Interview');
    await scope.getByRole('button', { name: 'Move Bongani', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /Bongani/ }), 'Move still opens the dialog').toBeVisible();
    expect(errors, 'no console error').toEqual([]);
  });
});

// ================================================================ AC-18 The hiring manager cannot reach Roles
/**
 * The steps of AC-18 for one login (T-4, T-5). `signInAs` signs that person in from the sign-in page. Every request whose path holds
 * /v1/roles or /v1/candidates is recorded from before the sign-in page opens.
 */
async function managerIsRefused(page: Page, signIn: SignInPage, doSignIn: () => Promise<void>): Promise<void> {
  const asked: string[] = [];
  const watch = (r: Request) => { const u = new URL(r.url()); if (/\/v1\/(roles|candidates)(\/|$)/.test(u.pathname)) asked.push(`${r.method()} ${u.pathname}`); };
  page.on('request', watch);
  await forgetSignIn(page);
  await doSignIn();
  await expect(signIn.message(NO_ACCESS), 'the refusal line, exactly').toBeVisible();
  await expect(page).toHaveURL(ON_SIGN_IN);
  const cognitoKeys = () => page.evaluate(() => [window.localStorage, window.sessionStorage].flatMap((s) => Array.from({ length: s.length }, (_, i) => s.key(i) ?? '')).filter((k) => k.startsWith('CognitoIdentityServiceProvider.')));
  expect(await cognitoKeys(), 'no sign-in library key is kept').toEqual([]);
  await expectNoSession(page);
  await page.goto('/hire/roles');
  await expect(page, 'the address /hire/roles ends on the sign-in page').toHaveURL(ON_SIGN_IN);
  await expect(signIn.email, 'the sign-in form shows').toBeVisible();
  await page.goto('/sign-in');
  await page.reload();
  await expect(signIn.email, 'after a reload of /sign-in the sign-in form still shows, not a signed-in page').toBeVisible();
  await expect(page).toHaveURL(ON_SIGN_IN);
  expect(await cognitoKeys(), 'still no key after the reload').toEqual([]);
  page.off('request', watch);
  expect(asked, 'no request to /v1/roles or /v1/candidates').toEqual([]);
}

test.describe('REC-UI-01.6 AC-18 The hiring manager cannot reach Roles', () => {
  test('AC-18 (no-backend proof of the dev check) The hiring manager of the fake is refused at sign-in with the exact line, keeps no token, and /hire/roles ends on the sign-in page with no Roles or candidates request', async ({ page, signIn, cognito, modules, hire }) => {
    noBackendOnly();
    const who: Who = WHO.managerA;
    await managerIsRefused(page, signIn, () => signInAs(signIn, cognito, modules, hire, who));
    expect(hire!.recruitmentCalls.map((c) => `${c.method} ${short(c.path)}`), 'the fake API got no Recruitment request').toEqual([]);
  });

  test('AC-18 @pepla-dev The hiring manager cannot reach Roles: refused at sign-in with the exact line, no token kept, /hire/roles ends on the sign-in page, no Roles or candidates request', async ({ page, signIn }) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only; the no-backend twin above proves the same steps before merge.');
    const email = process.env['E2E_MANAGER_EMAIL'], password = process.env['E2E_MANAGER_PASSWORD'];
    expect(email && password, 'the manager test login is set (E2E_MANAGER_EMAIL and _PASSWORD, from load-e2e-logins.py "manager")').toBeTruthy();
    await managerIsRefused(page, signIn, async () => {
      await signIn.open();
      await signIn.signInAs({ email: email!, password: password! });
    });
  });
});

// ================================================================ AC-19 Another person confirms a waiting decision on real data
type DevIds = { role: string; roleTitle: string; candidate: string; firstName: string; lastName: string; recorder: string; note: string; reasonCode: string };
const devIds = (): DevIds => JSON.parse(readFileSync(join(__dirname, 'support', 'rec-ui-01.6', 'dev-ids.json'), 'utf8')) as DevIds;

test.describe('REC-UI-01.6 AC-19 pepla-dev', () => {
  test('AC-19 @pepla-dev HR sees the seeded waiting decision on the board, the list sends only who it waits on, it survives a reload, and HR confirms it: one confirm, answered 200, and the card leaves', async ({ page, signIn, hr }) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only (seeded by seed-dev.py seed_recui01_6).');
    test.skip(test.info().project.name !== 'desktop-1280', 'Once per run, at 1280 (the seed writes one candidate; the confirm uses it up).');
    const ids = devIds();
    const name = `${ids.firstName} ${ids.lastName}`;
    const confirms: Array<{ path: string; status: number }> = [];
    page.on('response', (r) => { const u = new URL(r.url()); if (r.request().method() === 'POST' && /\/v1\/candidates\/[^/]+\/not-hired(\/confirm|\/cancel)?$/.test(u.pathname)) confirms.push({ path: u.pathname, status: r.status() }); });
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    const isList = (r: import('@playwright/test').Response) => r.request().method() === 'GET' && /\/v1\/candidates$/.test(new URL(r.url()).pathname) && new URL(r.url()).searchParams.get('role_id') === ids.role;
    const listed = page.waitForResponse(isList);
    await page.goto(`/hire/pipeline?role=${encodeURIComponent(ids.role)}&view=board`);
    await expect(h1(page)).toHaveText(ids.roleTitle);
    const answer = await (await listed).json();
    const row = ((answer?.candidates ?? []) as any[]).find((x) => x?.id === ids.candidate);
    expect(row, 'the seeded candidate is in the role\'s list').toBeTruthy();
    expect(row?.not_hired_pending, 'the list sends who it waits on, and only that').toEqual({ awaiting: { kind: 'HR' } });
    const text = JSON.stringify(answer);
    for (const v of [ids.note, 'zz-recui016', ids.recorder, ids.reasonCode]) expect(text.includes(v), `"${v}" (the seeded note, recorder or reason) is not in the answer`).toBe(false);
    const scope = main(page);
    await showStage(scope, 'Interview');
    await expect(card(scope, name).getByText(HR_MUST, { exact: true }), 'the card is in Interview with the HR line').toBeVisible();
    await page.reload();
    await expect(h1(page)).toHaveText(ids.roleTitle);
    await showStage(main(page), 'Interview');
    await expect(card(main(page), name).getByText(HR_MUST, { exact: true }), 'still there after a reload').toBeVisible();
    await cardMore(main(page), name).click();
    await page.getByRole('menuitem', { name: 'Not hired', exact: true }).click();
    const d = page.getByRole('dialog', { name: `${ids.firstName} not hired`, exact: true });
    await expect(d).toBeVisible();
    await d.getByRole('button', { name: 'Record not hired', exact: true }).click();
    await expect.poll(() => confirms.length, { timeout: 20_000 }).toBeGreaterThan(0);
    await quiet(page);
    expect(confirms.map((x) => `${x.path.replace(/^.*\/v1\//, '/v1/')} ${x.status}`), 'exactly one confirm, answered 200, and nothing else').toEqual([`/v1/candidates/${ids.candidate}/not-hired/confirm 200`]);
    await showStage(main(page), 'Interview');
    await expect(card(main(page), name), 'the card leaves the board').toHaveCount(0);
  });
});
