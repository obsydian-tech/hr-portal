import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { ON_DEV, avatarButton, type SignInPage } from './support/fixtures';
import type { CognitoFake } from './support/cognito-fake';
import type { ModulesFake } from './support/mod-02/modules-fake';
import { navLabels, openNav } from './support/mod-02/shell-snapshot';
import { COMPANY_ID, REASONS, WHO, companyIdIn, enter, iso, quiet, signInAs, watchErrors, type HireFake, type Who } from './support/rec-ui/harness';
import { chooseStage, dialog as moveDialog, moveButton, reason, visibleBlocks, WORDS as MOVE_WORDS } from './support/ang-01/gallery';
import { clockCases, readRows, table } from './support/rec-ui-02/lists';
import {
  NEVER, NEVER_NUMBERS, OLD_WORDS, RW, SETTING_VERSIONS, STALE, addCand, appliedOn, blockedTitle, day, daysInStage, detailsCard, expect, fromTo, hiredOn, main,
  nextStepCard, norm, openRecord, pageButton, pathList, personHeader, readCrumbs, readDetails, readHeader, readNextStep, readPath, tabNames, test, titleOf,
  type RecordFake,
} from './support/rec-ui-02/record';
import { RECORD_KIT } from './support/rec-ui-02/record-kit';

/**
 * REC-UI-02 step 3 · The candidate record, first version: header, hiring steps path, Overview; HR (Recruiter) only.
 * Jira NH-228 (epic NH-223, amber). Lock acceptance-lock/rec-ui-02.3 (one squashed commit with the two moved lines of
 * rec-ui-02.spec.ts, R-10 item 4). Spec: onboarding-cards/specs/REC-UI-02-candidate-record.md (R-1 to R-13, AC-R1 to AC-R15),
 * which wins over REC-UI-02.md for this step; its check REC-UI-02-nh228-spec-check.md (rounds 1 and 2: G-1 to G-5, N-1 to N-3);
 * decisions D-RUI-02.13 to D-RUI-02.21 in onboarding-cards/DECISIONS.md. Backend: REC-15 step C (PR 521, develop a1e82c1).
 * The record answer is built from api/openapi.yaml `CandidateRecord` and checked against it (support/rec-ui-02/record.ts).
 * Where the spec is silent, cards/rec-ui-02.md ("Step 3, the record") says what these tests take (D-T-R1 to D-T-R6).
 *
 * Not in this lock (behind flags or waiting for their backend, F-2): the Offer tab, the hired block, Reopen (U-8), the Batsi
 * note, More actions, the hiring manager and panel views. AC-R8 asserts they are absent. The Notes tab came with child lock
 * rec-ui-02.4 (NH-280 step 4) and the Interviews tab with child lock rec-ui-02.5 (INT-UI-01, NH-270).
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg.
 * AC-R15 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 */

const phone = () => test.info().project.name === 'phone-390';
const phoneOnly = (why: string) => test.skip(!phone(), `Phone only: ${why}`);
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');

type Fx = { page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null; record: RecordFake | null };
const fxOf = (a: Fx): Fx => a;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const BONGANI = 'cand-bongani';
const either = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true }).or(scope.getByRole('link', { name, exact: true }));
/** The tone modifiers of a lozenge (bold and large are sizes, not tones). */
const lozengeTones = (classes: string[]) => classes.filter((c) => /^pp-lozenge--/.test(c) && !/^pp-lozenge--(bold|large)$/.test(c));
const SAVE_FAIL = RW.saveFail;

async function asRecruiter(fx: Fx, who: Who = WHO.recruiterA): Promise<void> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
}
const cand = (hire: HireFake, id: string) => hire.world.cands.find((c) => c.id === id)!;
const now = (hire: HireFake) => hire.world.now;

/** Bongani as the kit draws him: Referral, applied 20 Oct 2026 (late on the 19th in UTC), Durban, Interview with 2 of 3 interviews done. */
function kitBongani(hire: HireFake, record: RecordFake): void {
  const b = cand(hire, BONGANI);
  b.source = 'Referral';
  b.applied_at = '2026-10-19T22:30:00.000Z';
  b.stage_entered_at = iso(now(hire) - 9 * DAY - HOUR);
  record.set(BONGANI, { location: 'Durban' });
}

/** The page holds nothing that looks like "null" or "undefined", and no empty breadcrumb, role or fact. */
async function noEmptyParts(page: Page): Promise<void> {
  const text = await main(page).innerText();
  expect(text, 'no "null" or "undefined" drawn').not.toMatch(/\b(null|undefined|NaN|Invalid Date)\b/);
  for (const c of await readCrumbs(page)) expect(c.text, 'no empty breadcrumb item').not.toBe('');
  const h = await readHeader(page);
  for (const f of h.facts) expect(f, 'no empty fact').not.toBe('');
  expect(h.role, 'no stray dot in the role line').not.toMatch(/^\s*·|·\s*$|·\s*·/);
}

// ================================================================ AC-R1 Getting there (R-10)
test.describe('AC-R1 Getting there', () => {
  test.beforeEach(noBackendOnly);

  test('AC-R1 Every row of Candidates has the kit\'s "Open {name}" control; it opens that candidate\'s record at /hire/candidates/{id}, read once, and no console error', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, record } = fx;
    const errors = watchErrors(page);
    await asRecruiter(fx);
    await page.goto('/hire/candidates');
    await expect(table(page)).toBeVisible();
    await quiet(page);
    const rows = await readRows(page);
    expect(rows.length).toBeGreaterThan(5);
    for (const r of rows) await expect(either(main(page), `Open ${r.name}`), `"Open ${r.name}"`).toHaveCount(1);
    for (const [name, id] of [['Bongani Mthembu', BONGANI], ['Amahle Dlamini', 'cand-amahle'], ['Vusi Naidoo', 'cand-s3']] as const) {
      await page.goto('/hire/candidates');
      await expect(table(page)).toBeVisible();
      const before = record!.reads(id).length;
      await either(main(page), `Open ${name}`).click();
      await expect(page).toHaveURL(new RegExp(`/hire/candidates/${id}$`));
      await expect.poll(async () => (await readHeader(page)).name).toBe(name);
      await quiet(page);
      expect(record!.reads(id).length - before, `${name}'s record is read once on open (R-2)`).toBe(1);
      expect(record!.reads().every((c) => c.path.endsWith(`/v1/candidates/${c.path.split('/').pop()}`))).toBe(true);
    }
    expect(errors, 'no console error').toEqual([]);
  });

  test('AC-R1 The Pipeline list (all roles and one role) opens the right record from its row', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page } = fx;
    await asRecruiter(fx);
    for (const [path, name, id] of [['/hire/pipeline', 'Kagiso Molefe', 'cand-kagiso'], ['/hire/pipeline?role=role-warehouse&view=list', 'Pule Maseko', 'cand-w3']] as const) {
      await page.goto(path);
      await expect(table(page)).toBeVisible();
      await quiet(page);
      for (const r of await readRows(page)) await expect(either(main(page), `Open ${r.name}`), `"Open ${r.name}"`).toHaveCount(1);
      await either(main(page), `Open ${name}`).click();
      await expect(page).toHaveURL(new RegExp(`/hire/candidates/${id}$`));
      await expect.poll(async () => (await readHeader(page)).name).toBe(name);
    }
  });

  test('AC-R1 An old-system row opens its record with "Not hired" and no reason line (R-5 item 3)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page } = fx;
    await asRecruiter(fx);
    await page.goto('/hire/candidates/old-system');
    await either(main(page), 'Open Mpho Sithole').first().click();
    await expect(page).toHaveURL(/\/hire\/candidates\/cand-os-1$/);
    const h = await readHeader(page);
    expect(h.name).toBe('Mpho Sithole');
    expect(h.lozenge?.words).toBe(RW.notHired);
    const text = await main(page).innerText();
    for (const [, words] of REASONS) expect(text, `no reason line ("${words}")`).not.toContain(words);
  });

  test('AC-R1 The address alone opens the record, also after a reload', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, record } = fx;
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    expect((await readHeader(page)).name).toBe('Bongani Mthembu');
    await page.reload();
    await expect.poll(async () => (await readHeader(page)).name).toBe('Bongani Mthembu');
    expect(record!.reads(BONGANI).length).toBe(2);
    await expect(page).toHaveTitle(titleOf('Bongani Mthembu'));
  });

  test('AC-R1 The board\'s cards are unchanged: no link to a record and no Open button (D-RUI-02.20)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page } = fx;
    await asRecruiter(fx);
    await page.goto('/hire/pipeline?role=role-fleet&view=board');
    await expect(page.locator('pp-pipeline-board, .pp-pipeline-board').first()).toBeVisible();
    await quiet(page);
    await expect(main(page).locator('a[href*="/hire/candidates/cand-"]'), 'no card links to a record').toHaveCount(0);
    await expect(main(page).getByRole('button', { name: /^Open / }), 'no Open button on a card').toHaveCount(0);
  });
});

// ================================================================ AC-R2 Header (R-2, R-3)
test.describe('AC-R2 Header', () => {
  test.beforeEach(noBackendOnly);

  test('AC-R2 Breadcrumb "Candidates" to the list then the name; initials, name, one lozenge, role line with the level\'s name, source, "Applied {date}", location; the tab title carries the name', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire, record } = fx;
    kitBongani(hire!, record!);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    const crumbs = await readCrumbs(page);
    expect(crumbs.map((c) => c.text)).toEqual([RW.candidates, 'Bongani Mthembu']);
    expect(crumbs[0]!.href, '"Candidates" goes to the list (always, in this step)').toBe('/hire/candidates');
    const h = await readHeader(page);
    expect(h).toMatchObject({ name: 'Bongani Mthembu', initials: 'BM', role: 'Fleet controller · Operations · Mid', facts: ['Referral', appliedOn('20 Oct 2026'), 'Durban'] });
    expect(h.lozenges, 'one status at most').toBe(1);
    await expect(page.getByRole('heading', { level: 1, name: 'Bongani Mthembu', exact: true })).toHaveCount(1);
    await expect(page).toHaveTitle(titleOf('Bongani Mthembu'));
    expect(await main(page).innerText(), 'the level key is never shown').not.toMatch(/\bMID\b/);
    await noEmptyParts(page);
  });

  test('AC-R2 The level\'s name comes from the options read: a renamed level shows its new name; a key the options do not know, or a failed options read, leaves the level out (G-1)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire, record } = fx;
    hire!.world.options.A.levels = hire!.world.options.A.levels.map((l) => (l.key === 'MID' ? { ...l, label: 'Intermediate' } : l));
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    expect((await readHeader(page)).role).toBe('Fleet controller · Operations · Intermediate');
    expect(await readDetails(page)).toContainEqual(['Level', 'Intermediate']);
    record!.set(BONGANI, { level: 'PRINCIPAL' });
    await openRecord(page, BONGANI);
    expect((await readHeader(page)).role, 'a key the options do not know is left out').toBe('Fleet controller · Operations');
    expect((await readDetails(page)).map(([k]) => k)).not.toContain('Level');
    expect(await main(page).innerText()).not.toContain('PRINCIPAL');
    record!.set(BONGANI, { level: 'MID' });
    hire!.refuse({ method: 'GET', path: /\/v1\/roles\/options$/, status: 500, once: false });
    await openRecord(page, BONGANI);
    expect((await readHeader(page)).role, 'options failed: no level').toBe('Fleet controller · Operations');
    expect((await readDetails(page)).map(([k]) => k)).not.toContain('Level');
    expect(await main(page).innerText()).not.toMatch(/\bMID\b/);
  });

  test('AC-R2 Each null part is left out with its dot: no department, no role title, no level, no source, no applied date, no location', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, record } = fx;
    await asRecruiter(fx);
    const cases: Array<[Parameters<RecordFake['set']>[1], string, string[]]> = [
      [{ department: null, source: 'Referral' }, 'Fleet controller · Mid', ['Referral', appliedOn('4 Nov 2026'), 'Durban']],
      [{ department: 'Operations', role_title: null, location: null }, 'Operations · Mid', ['Referral', appliedOn('4 Nov 2026')]],
      [{ role_title: 'Fleet controller', level: null, applied_at: null, source: 'LinkedIn' }, 'Fleet controller · Operations', ['LinkedIn']],
      [{ role_title: null, department: null, level: null, source: null, applied_at: null, location: null }, '', []],
    ];
    for (const [x, role, facts] of cases) {
      record!.set(BONGANI, x);
      await openRecord(page, BONGANI);
      const h = await readHeader(page);
      expect(h.role, JSON.stringify(x)).toBe(role);
      expect(h.facts, JSON.stringify(x)).toEqual(facts);
      await noEmptyParts(page);
    }
  });

  test('AC-R2 Names are trimmed and joined by one space; with both parts null the title stays "Candidate · Naleko People" and no empty breadcrumb is drawn (N-3)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, record } = fx;
    await asRecruiter(fx);
    record!.set(BONGANI, { firstName: '  Bongani ', lastName: ' Mthembu  ' });
    await openRecord(page, BONGANI);
    expect((await readHeader(page)).name).toBe('Bongani Mthembu');
    expect((await readHeader(page)).initials, 'initials come from the trimmed names').toBe('BM');
    expect((await readCrumbs(page)).map((c) => c.text)).toEqual([RW.candidates, 'Bongani Mthembu']);
    await expect(page).toHaveTitle(titleOf('Bongani Mthembu'));
    record!.set(BONGANI, { firstName: 'Bongani', lastName: null });
    await openRecord(page, BONGANI);
    expect((await readHeader(page)).name).toBe('Bongani');
    await expect(page).toHaveTitle(titleOf('Bongani'));
    record!.set(BONGANI, { firstName: null, lastName: null });
    await openRecord(page, BONGANI);
    await expect(personHeader(page)).toBeVisible();
    await quiet(page);
    await expect(page).toHaveTitle(RW.titleLoading);
    for (const c of await readCrumbs(page)) expect(c.text, 'no empty breadcrumb item').not.toBe('');
    expect(await main(page).innerText()).not.toMatch(/\b(null|undefined)\b/);
  });

  test('AC-R2 The page reads the new fields, never the old ones (N-1): stale positionTitle, positionLevel, appliedDate and currentStage are not shown', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page } = fx;
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    const text = await main(page).innerText();
    expect(text).not.toContain(STALE.positionTitle);
    expect(text).not.toContain(day(STALE.appliedDate));
    expect(text, 'the stale level (SENIOR) is not shown').not.toMatch(/\bSenior\b/);
    expect((await readHeader(page)).facts).toContain(appliedOn('4 Nov 2026'));
    expect((await readPath(page)).find((s) => s.state === 'current')?.label, 'the stage is `stage`, not `currentStage`').toBe('Interview');
  });
});

// ================================================================ AC-R3 Actions (R-8)
test.describe('AC-R3 Actions', () => {
  test.beforeEach(noBackendOnly);

  test('AC-R3 Move shows only with can_move; Not hired only with can_decide on an open stage; Hired and Not hired records show neither (G-4); More actions is absent', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire, record } = fx;
    addCand(hire!, { id: 'cand-hired-1', name: 'Sibusiso Khoza', stage: 'HIRED', stage_entered_at: iso(now(hire!) - 3 * DAY) });
    await asRecruiter(fx);
    const cases: Array<[string, Parameters<RecordFake['set']>[1], boolean, boolean]> = [
      ['cand-amahle', {}, true, true], ['cand-tariro', {}, true, true], [BONGANI, {}, true, true], ['cand-kagiso', {}, true, true],
      [BONGANI, { can_move: false }, false, true], [BONGANI, { can_move: true, can_decide: false }, true, false],
      ['cand-nomvula', { can_decide: true, can_move: false }, false, false], ['cand-hired-1', { can_decide: true, can_move: false }, false, false],
    ];
    for (const [id, x, move, notHired] of cases) {
      record!.set(id, x);
      await openRecord(page, id);
      await quiet(page);
      const where = `${id} ${JSON.stringify(x)}`;
      await expect(pageButton(page, RW.move), `${where}: Move`).toHaveCount(move ? 1 : 0);
      await expect(pageButton(page, RW.notHired), `${where}: Not hired`).toHaveCount(notHired ? 1 : 0);
      if (move) await expect(pageButton(page, RW.move)).toBeVisible();
      if (notHired) await expect(pageButton(page, RW.notHired)).toBeVisible();
      await expect(main(page).getByRole('button', { name: /^More actions/ }), `${where}: no More actions`).toHaveCount(0);
      await expect(main(page).getByRole('button', { name: /^Reopen/ }).or(main(page).getByRole('link', { name: /^Reopen/ })), `${where}: no Reopen`).toHaveCount(0);
    }
  });

  test('AC-R3 Move opens REC-UI-01\'s dialog with its words; confirming sends one PUT { to, reason } with an Idempotency-Key, then the page reads the record once more and the path and lozenge change', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire, record } = fx;
    await asRecruiter(fx);
    await openRecord(page, 'cand-amahle');
    await quiet(page);
    expect((await readHeader(page)).lozenge).toMatchObject({ words: 'On track, 3 days left' });
    await pageButton(page, RW.move).click();
    const d = moveDialog(page, 'Amahle Dlamini');
    await expect(d).toBeVisible();
    await expect.poll(async () => (await visibleBlocks(d)).join(' | '), { message: 'the dialog has finished opening' }).toContain('Move Amahle');
    const words = (await visibleBlocks(d)).join(' | ');
    for (const w of ['Move Amahle', MOVE_WORDS.field, MOVE_WORDS.reason, MOVE_WORDS.reasonHelp, MOVE_WORDS.cancel, MOVE_WORDS.move]) expect(words, `the dialog says "${w}"`).toContain(w);
    await chooseStage(d, 'Screening');
    await reason(d).fill('Phone screen booked');
    const readsBefore = record!.reads('cand-amahle').length;
    hire!.refuse({ method: 'PUT', path: /\/stage$/, hold: true });
    await moveButton(d).click();
    await expect.poll(() => hire!.to('PUT', /\/stage$/).length).toBe(1);
    // The server starts the new stage's clock: a day late already.
    const c = cand(hire!, 'cand-amahle');
    c.due_at = iso(now(hire!) - DAY);
    c.sla_status = 'OVERDUE';
    hire!.release();
    await expect.poll(async () => (await readPath(page)).find((s) => s.state === 'current')?.label).toBe('Screening');
    const put = hire!.to('PUT', /\/stage$/);
    expect(put).toHaveLength(1);
    expect(put[0]!.path).toMatch(/\/v1\/candidates\/cand-amahle\/stage$/);
    expect(put[0]!.body).toEqual({ to: 'SCREENING', reason: 'Phone screen booked' });
    expect(put[0]!.idempotencyKey).toMatch(/^[\w-]{8,}$/);
    expect(companyIdIn(put[0]!)).toEqual([]);
    await quiet(page);
    expect(record!.reads('cand-amahle').length - readsBefore, 'the record is read once more after the move').toBe(1);
    const path = await readPath(page);
    expect(path.find((s) => s.state === 'current')).toEqual({ label: 'Screening', state: 'current', meta: daysInStage(0) });
    expect(path.find((s) => s.label === 'Applied')?.state).toBe('done');
    const h = await readHeader(page);
    expect(h.lozenge?.words).toBe('Overdue by 1 day');
    expect(h.lozenge?.classes).toContain('pp-lozenge--danger');
    await expect(moveDialog(page, 'Amahle Dlamini')).toHaveCount(0);
    expect((await readNextStep(page))?.subtitle).toBe(fromTo('SCREENING', 'INTERVIEW'));
  });

  test('AC-R3 Cancel in the Move dialog sends nothing and changes nothing', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    await asRecruiter(fx);
    await openRecord(page, 'cand-amahle');
    await pageButton(page, RW.move).click();
    const d = moveDialog(page, 'Amahle Dlamini');
    await chooseStage(d, 'Screening');
    await reason(d).fill('Not yet');
    await d.getByRole('button', { name: MOVE_WORDS.cancel, exact: true }).click();
    await expect(d).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(hire!.to('PUT', /\/stage$/)).toHaveLength(0);
    expect((await readPath(page)).find((s) => s.state === 'current')?.label).toBe('Applied');
  });

  test('AC-R3 A refused move shows REC-UI-01\'s save failure line and the record stays as it was', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    await asRecruiter(fx);
    await openRecord(page, 'cand-amahle');
    await pageButton(page, RW.move).click();
    const d = moveDialog(page, 'Amahle Dlamini');
    await chooseStage(d, 'Screening');
    await reason(d).fill('Phone screen booked');
    hire!.refuse({ method: 'PUT', path: /\/stage$/, status: 409, body: { error: 'x', code: 'NOT_OPEN' } });
    await moveButton(d).click();
    await expect(page.getByText(SAVE_FAIL, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    expect((await readPath(page)).find((s) => s.state === 'current')?.label).toBe('Applied');
  });

  test('AC-R3 Not hired opens REC-UI-01\'s dialog (eight reasons in order); recording sends one POST with the code, then the page reads again: "Not hired", no current step, no Move or Not hired', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire, record } = fx;
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await quiet(page);
    await pageButton(page, RW.notHired).click();
    const d = page.getByRole('dialog', { name: 'Bongani not hired', exact: true });
    await expect(d).toBeVisible();
    const radios = await d.getByRole('radio').evaluateAll((rs) => rs.map((r) => (document.querySelector(`label[for="${r.id}"]`)?.textContent ?? r.closest('label')?.textContent ?? r.getAttribute('aria-label') ?? '').trim()));
    expect(radios, 'the eight reasons, in the approved order').toEqual(REASONS.map(([, w]) => w));
    await expect(d.getByRole('button', { name: RW.recordNotHired, exact: true })).toBeDisabled();
    await d.getByRole('radio', { name: 'Salary did not match', exact: true }).check();
    const readsBefore = record!.reads(BONGANI).length;
    await d.getByRole('button', { name: RW.recordNotHired, exact: true }).click();
    await expect.poll(async () => (await readHeader(page)).lozenge?.words).toBe(RW.notHired);
    const posts = hire!.to('POST', /\/not-hired$/);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toMatch(/\/v1\/candidates\/cand-bongani\/not-hired$/);
    expect(posts[0]!.body).toEqual({ reason: 'SALARY_MISMATCH' });
    await quiet(page);
    expect(record!.reads(BONGANI).length - readsBefore, 'the record is read once more after Not hired').toBe(1);
    await expect(d).toHaveCount(0);
    expect((await readPath(page)).filter((s) => s.state === 'current')).toEqual([]);
    await expect(pageButton(page, RW.move)).toHaveCount(0);
    await expect(pageButton(page, RW.notHired)).toHaveCount(0);
  });

  test('AC-R3 A refused Not hired shows REC-UI-01\'s failure line in the dialog and the record stays as it was', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await pageButton(page, RW.notHired).click();
    const d = page.getByRole('dialog', { name: 'Bongani not hired', exact: true });
    await d.getByRole('radio', { name: 'Candidate withdrew', exact: true }).check();
    hire!.refuse({ method: 'POST', path: /\/not-hired$/, status: 500 });
    await d.getByRole('button', { name: RW.recordNotHired, exact: true }).click();
    await expect(d.getByText(SAVE_FAIL, { exact: true })).toBeVisible();
    await d.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await readHeader(page)).lozenge?.words).toBe('Overdue by 2 days');
    expect((await readPath(page)).find((s) => s.state === 'current')?.label).toBe('Interview');
  });
});

// ================================================================ AC-R4 Path (R-4)
test.describe('AC-R4 Path', () => {
  test.beforeEach(noBackendOnly);

  test('AC-R4 Five steps in kit order; steps before the current one are done; text only on the current step: "9 days in stage"', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire, record } = fx;
    kitBongani(hire!, record!);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    expect(await readPath(page)).toEqual([
      { label: 'Applied', state: 'done', meta: '' }, { label: 'Screening', state: 'done', meta: '' }, { label: 'Interview', state: 'current', meta: daysInStage(9) },
      { label: 'Offer', state: 'other', meta: '' }, { label: 'Hired', state: 'other', meta: '' },
    ]);
  });

  test('AC-R4 Days in stage are whole days since stage_entered_at, rounded down: 0 under a day, "1 day in stage", 1 at just under two days, 2 at 2.9 days (D-RUI-02.14)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    await asRecruiter(fx);
    const t = now(hire!);
    for (const [ago, n] of [[5 * HOUR, 0], [DAY + 3 * HOUR, 1], [2 * DAY - 60_000, 1], [2.9 * DAY, 2], [30 * DAY + HOUR, 30]] as const) {
      cand(hire!, 'cand-tariro').stage_entered_at = iso(t - ago);
      await openRecord(page, 'cand-tariro');
      const steps = await readPath(page);
      expect(steps.find((s) => s.state === 'current'), `${ago / HOUR} hours ago`).toEqual({ label: 'Screening', state: 'current', meta: daysInStage(n) });
      expect(steps.filter((s) => s.state !== 'current').map((s) => s.meta), 'no text on any other step').toEqual(['', '', '', '']);
    }
  });

  test('AC-R4 Screening is left out when the options say it is off, and all five steps show when the options read fails', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    hire!.world.options.A.screening = false;
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    expect((await readPath(page)).map((s) => s.label)).toEqual(['Applied', 'Interview', 'Offer', 'Hired']);
    expect((await readPath(page)).map((s) => s.state)).toEqual(['done', 'current', 'other', 'other']);
    hire!.refuse({ method: 'GET', path: /\/v1\/roles\/options$/, status: 500, once: false });
    await openRecord(page, BONGANI);
    expect((await readPath(page)).map((s) => s.label)).toEqual(['Applied', 'Screening', 'Interview', 'Offer', 'Hired']);
    hire!.lift();
    hire!.refuse({ method: 'GET', path: /\/v1\/roles\/options$/, abort: true, once: false });
    await openRecord(page, BONGANI);
    expect((await readPath(page)).map((s) => s.label)).toEqual(['Applied', 'Screening', 'Interview', 'Offer', 'Hired']);
    hire!.lift();
    hire!.refuse({ method: 'GET', path: /\/v1\/roles\/options$/, status: 200, body: { screening: false }, once: false });
    await openRecord(page, BONGANI);
    expect((await readPath(page)).map((s) => s.label), 'an answer that is not RoleOptions counts as failed').toEqual(['Applied', 'Screening', 'Interview', 'Offer', 'Hired']);
  });

  test('AC-R4 Hired: every earlier step done and the Hired step reads "Hired {date}" in Johannesburg time; no other step has text', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    // The applied date is on another day, so a Hired date taken from applied_at fails (lock check F-1).
    addCand(hire!, { id: 'cand-hired-1', name: 'Sibusiso Khoza', stage: 'HIRED', stage_entered_at: '2026-11-11T23:30:00.000Z', applied_at: '2026-10-05T08:00:00.000Z' });
    await asRecruiter(fx);
    await openRecord(page, 'cand-hired-1');
    const steps = await readPath(page);
    expect(steps.map((s) => s.label)).toEqual(['Applied', 'Screening', 'Interview', 'Offer', 'Hired']);
    expect(steps.slice(0, 4).map((s) => s.state)).toEqual(['done', 'done', 'done', 'done']);
    // D-T-R1: the spec says "every step done", the kit draws Hired as the current step; either look passes, the words do not move.
    expect(['done', 'current']).toContain(steps[4]!.state);
    expect(steps[4]!.meta).toBe(hiredOn('12 Nov 2026'));
    expect(steps.slice(0, 4).map((s) => s.meta)).toEqual(['', '', '', '']);
  });

  test('AC-R4 Not hired: no step is current and no step has text', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page } = fx;
    await asRecruiter(fx);
    for (const id of ['cand-nomvula', 'cand-os-1']) {
      await openRecord(page, id);
      const steps = await readPath(page);
      expect(steps.filter((s) => s.state === 'current'), id).toEqual([]);
      expect(steps.map((s) => s.meta), id).toEqual(steps.map(() => ''));
      expect(steps.map((s) => s.label)).toEqual(['Applied', 'Screening', 'Interview', 'Offer', 'Hired']);
    }
  });
});

// ================================================================ AC-R5 Lozenge (R-5)
test.describe('AC-R5 Lozenge', () => {
  test.beforeEach(noBackendOnly);

  test('AC-R5 Each stage clock gives the lists\' words with the R-5 look: Overdue danger, Due warning, On track plain; no due date, no lozenge', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    const cases = clockCases(now(hire!)).filter(([c]) => c.stage !== 'HIRED');
    hire!.world.cands.push(...cases.map(([c]) => c));
    await asRecruiter(fx);
    for (const [c, words, tone] of cases) {
      await openRecord(page, c.id);
      const h = await readHeader(page);
      if (tone === 'none') { expect(h.lozenges, `${c.name}: no lozenge`).toBe(0); continue; }
      expect(h.lozenge?.words, c.name).toBe(words);
      const tones = lozengeTones(h.lozenge!.classes);
      expect(tones, `${c.name}: the look`).toEqual(tone === 'danger' ? ['pp-lozenge--danger'] : tone === 'warning' ? ['pp-lozenge--warning'] : []);
      expect(h.lozenges).toBe(1);
    }
  });

  test('AC-R5 Hired reads "Hired" with the success look; Not hired reads "Not hired", plain; neither shows a clock', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    addCand(hire!, { id: 'cand-hired-1', name: 'Sibusiso Khoza', stage: 'HIRED', stage_entered_at: iso(now(hire!) - 3 * DAY) });
    await asRecruiter(fx);
    for (const [id, words, look] of [['cand-hired-1', RW.hired, ['pp-lozenge--success']], ['cand-nomvula', RW.notHired, []], ['cand-os-1', RW.notHired, []]] as const) {
      await openRecord(page, id);
      const h = await readHeader(page);
      expect(h.lozenge?.words, id).toBe(words);
      expect(lozengeTones(h.lozenge!.classes), `${id}: the look`).toEqual([...look]);
      expect(h.lozenges).toBe(1);
      expect(await main(page).innerText()).not.toMatch(/Overdue|Due today|Due in|On track/);
    }
  });
});

// ================================================================ AC-R6 Next step (R-6)
test.describe('AC-R6 Next step', () => {
  test.beforeEach(noBackendOnly);

  test('AC-R6 No card when next_step is null (Offer, Hired, Not hired)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page } = fx;
    await asRecruiter(fx);
    for (const id of ['cand-kagiso', 'cand-nomvula']) {
      await openRecord(page, id);
      await expect(personHeader(page)).toBeVisible();
      await quiet(page);
      await expect(nextStepCard(page), id).toHaveCount(0);
      await expect(main(page).getByText(RW.nextStep, { exact: true }), id).toHaveCount(0);
    }
  });

  test('AC-R6 With no blocker: the title and "{From} to {To}" only, no message and no button', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire, record } = fx;
    await asRecruiter(fx);
    for (const [id, from, to] of [['cand-amahle', 'APPLIED', 'SCREENING'], ['cand-tariro', 'SCREENING', 'INTERVIEW']] as const) {
      await openRecord(page, id);
      expect(await readNextStep(page), id).toEqual({ subtitle: fromTo(from, to), messages: [], buttons: [] });
      expect(norm(await nextStepCard(page).innerText())).toBe(norm(`${RW.nextStep} ${fromTo(from, to)}`));
    }
    // An Interview with every required interview done: the server sends no blocker.
    record!.set(BONGANI, { next_step: { from: 'INTERVIEW', to: 'OFFER', blocker: null } });
    await openRecord(page, BONGANI);
    expect(await readNextStep(page)).toEqual({ subtitle: fromTo('INTERVIEW', 'OFFER'), messages: [], buttons: [] });
    // With Screening off the server says Applied to Interview, and the page says what the server says.
    hire!.world.options.A.screening = false;
    await openRecord(page, 'cand-amahle');
    expect((await readNextStep(page))?.subtitle).toBe(fromTo('APPLIED', 'INTERVIEW'));
  });

  test('AC-R6 INTERVIEWS_INCOMPLETE: a warning with "{first name} cannot move on yet" and "Every required interview must be done first." only; no "Go to interviews", no counts, no named person (W-9d, D-RUI-02.13)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, record } = fx;
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    const n = await readNextStep(page);
    expect(n?.subtitle).toBe(fromTo('INTERVIEW', 'OFFER'));
    expect(n?.messages.map(({ title, body }) => ({ title, body }))).toEqual([{ title: blockedTitle('Bongani'), body: RW.blockedBody }]);
    expect(n?.messages[0]!.classes).toContain('pp-section-message--warning');
    expect(n?.buttons).toEqual([]);
    expect(norm(await nextStepCard(page).innerText()), 'nothing else in the card (no 2 of 3, no named person)').toBe(norm(`${RW.nextStep} ${fromTo('INTERVIEW', 'OFFER')} ${blockedTitle('Bongani')} ${RW.blockedBody}`));
    await expect(pageButton(page, RW.goToInterviews)).toHaveCount(0);
    expect(await main(page).innerText()).not.toMatch(/feedback|technical interview/i);
    // The first name is the record's, trimmed.
    record!.set(BONGANI, { firstName: '  Bongani  ' });
    await openRecord(page, BONGANI);
    expect((await readNextStep(page))?.messages.map((m) => m.title)).toEqual([blockedTitle('Bongani')]);
    record!.set(BONGANI, { firstName: 'Sizwe' });
    await openRecord(page, BONGANI);
    expect((await readNextStep(page))?.messages.map((m) => m.title), 'from firstName').toEqual([blockedTitle('Sizwe')]);
  });
});

// ================================================================ AC-R7 Details (R-7)
test.describe('AC-R7 Details', () => {
  test.beforeEach(noBackendOnly);

  test('AC-R7 Email, Phone, Level, Source in that order from the answer, as plain text (no mailto or tel link)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire, record } = fx;
    kitBongani(hire!, record!);
    record!.set(BONGANI, { email: 'bongani.mthembu@gmail.com', phone: '083 555 0198' });
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    expect(await readDetails(page)).toEqual([['Email', 'bongani.mthembu@gmail.com'], ['Phone', '083 555 0198'], ['Level', 'Mid'], ['Source', 'Referral']]);
    await expect(detailsCard(page).locator('a[href^="mailto:"], a[href^="tel:"]')).toHaveCount(0);
  });

  test('AC-R7 A row whose value is null is left out, with no word in its place (D-RUI-02.18)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, record } = fx;
    await asRecruiter(fx);
    const cases: Array<[Parameters<RecordFake['set']>[1], string[]]> = [
      [{ email: null, source: 'Referral' }, ['Phone', 'Level', 'Source']],
      [{ email: 'b@example.org', phone: null, source: null }, ['Email', 'Level']],
      [{ email: null, phone: null, level: null, source: null }, []],
    ];
    for (const [x, keys] of cases) {
      record!.set(BONGANI, x);
      await openRecord(page, BONGANI);
      await quiet(page);
      // With every row empty the card may stay or go (the spec is silent); it holds no row either way.
      if (!keys.length) { await expect(detailsCard(page).locator('dt, dd')).toHaveCount(0); continue; }
      const rows = await readDetails(page);
      expect(rows.map(([k]) => k), JSON.stringify(x)).toEqual(keys);
      for (const [, v] of rows) expect(v).not.toBe('');
      expect(await detailsCard(page).innerText()).not.toMatch(/\b(null|undefined|Not given|None)\b/);
    }
  });
});

// ================================================================ AC-R8 What waits (F-2 table)
test.describe('AC-R8 What waits', () => {
  test.beforeEach(noBackendOnly);

  // Child lock rec-ui-02.4 (NH-280 step 4): the tab strip now shows Notes after Overview; the Overview itself is unchanged.
  // Child lock rec-ui-02.5 (INT-UI-01, NH-270): the tab strip now shows Interviews between them, in the kit's order (Offer still off).
  test('AC-R8 The tab strip shows Overview, Interviews and Notes only: no Offer tab and no tab count; the Overview has no history, More actions, Reopen, Batsi note, Go to interviews or hired block', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    addCand(hire!, { id: 'cand-hired-1', name: 'Sibusiso Khoza', stage: 'HIRED', stage_entered_at: iso(now(hire!) - 3 * DAY) });
    await asRecruiter(fx);
    for (const id of [BONGANI, 'cand-kagiso', 'cand-hired-1', 'cand-nomvula']) {
      await openRecord(page, id);
      await quiet(page);
      expect(await tabNames(page), id).toEqual([RW.overview, 'Interviews', 'Notes']);
      await expect(main(page).locator('.pp-tabs__count'), `${id}: no tab count`).toHaveCount(0);
      await expect(main(page).getByRole('button', { name: /^More actions/ })).toHaveCount(0);
      await expect(main(page).getByRole('button', { name: /^Reopen/ })).toHaveCount(0);
      await expect(main(page).locator('.pp-section-message--agent'), `${id}: no Batsi note`).toHaveCount(0);
      await expect(pageButton(page, RW.goToInterviews)).toHaveCount(0);
      await expect(main(page).locator('pp-masked-field, .pp-masked-field, pp-timeline, .pp-timeline, pp-drawer')).toHaveCount(0);
      const text = await main(page).innerText();
      expect(text, id).not.toMatch(/Batsi|Employee record created|Open in Onboarding/);
    }
  });
});

// ================================================================ AC-R9 Never drawn (R-2)
test.describe('AC-R9 Never drawn', () => {
  test.beforeEach(noBackendOnly);

  test('AC-R9 None of the fields R-2 says are never drawn reaches the page, the tab title or an attribute (marker values in the fake)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire } = fx;
    addCand(hire!, { id: 'cand-hired-1', name: 'Sibusiso Khoza', stage: 'HIRED', stage_entered_at: iso(now(hire!) - 3 * DAY) });
    await asRecruiter(fx);
    const numbers = [...Object.values(NEVER_NUMBERS), ...Object.values(SETTING_VERSIONS)].map(String);
    for (const id of [BONGANI, 'cand-amahle', 'cand-kagiso', 'cand-hired-1', 'cand-nomvula', 'cand-os-1']) {
      await openRecord(page, id);
      await quiet(page);
      const html = await page.content();
      for (const [field, v] of Object.entries(NEVER)) expect(html, `${id}: ${field}`).not.toContain(v);
      const text = `${await page.locator('body').innerText()} ${await page.title()}`;
      for (const n of numbers) expect(text, `${id}: a number from finalScore, engagementScore or settingVersions`).not.toContain(n);
      // Lock check F-2: nor in any attribute (a tooltip is seen too). The numbers appear nowhere else, so whole-number matches only.
      for (const n of numbers) expect(html, `${id}: ${n} in the page HTML`).not.toMatch(new RegExp(`(^|[^0-9])${n}([^0-9]|$)`));
      expect(html).not.toContain(STALE.positionTitle);
    }
  });
});

// ================================================================ AC-R10 States (R-9)
test.describe('AC-R10 States', () => {
  test.beforeEach(noBackendOnly);

  test('AC-R10 While the record loads the page shows pp-skeleton and the title "Candidate · Naleko People"; no name until the answer', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, record } = fx;
    await asRecruiter(fx);
    record!.refuse({ hold: true });
    await page.goto(`/hire/candidates/${BONGANI}`);
    await expect.poll(() => record!.heldCount).toBe(1);
    await expect(main(page).locator('.pp-skeleton').first()).toBeVisible();
    await expect(page).toHaveTitle(RW.titleLoading);
    expect(await page.content()).not.toContain('Bongani');
    record!.release();
    await expect.poll(async () => (await readHeader(page)).name).toBe('Bongani Mthembu');
    await expect(main(page).locator('.pp-skeleton')).toHaveCount(0);
    await expect(page).toHaveTitle(titleOf('Bongani Mthembu'));
    // Lock check F-3: another record reached inside the app (Back, or a link), with no page load: while it loads the title is
    // the loading title again and Bongani is nowhere; an unknown id reached the same way shows not-found and no Bongani either.
    const inApp = (id: string) => page.evaluate((x) => { history.pushState({}, '', `/hire/candidates/${x}`); dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, id);
    record!.refuse({ hold: true, id: 'cand-amahle' });
    await inApp('cand-amahle');
    await expect.poll(() => record!.heldCount).toBe(1);
    await expect(page).toHaveTitle(RW.titleLoading);
    expect(await page.content(), 'nothing of Bongani while the next record loads').not.toContain('Bongani');
    record!.release();
    await expect.poll(async () => (await personHeader(page).count()) && (await readHeader(page)).name).toBe('Amahle Dlamini');
    await inApp('cand-does-not-exist');
    await expect(main(page).getByText(RW.notFound, { exact: true })).toBeVisible();
    await quiet(page);
    expect(await page.title(), 'a not-found record does not keep the last name in the tab title').not.toMatch(/Amahle|Bongani/);
    expect(await page.content()).not.toMatch(/Amahle|Bongani/);
  });

  test('AC-R10 A 404 shows "This candidate could not be found." and nothing of a candidate', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, record } = fx;
    await asRecruiter(fx);
    await openRecord(page, 'cand-nobody');
    await expect(main(page).getByText(RW.notFound, { exact: true })).toBeVisible();
    await expect(personHeader(page)).toHaveCount(0);
    await expect(pathList(page)).toHaveCount(0);
    await expect(nextStepCard(page)).toHaveCount(0);
    await expect(detailsCard(page)).toHaveCount(0);
    await expect(main(page).getByRole('tab')).toHaveCount(0);
    await expect(pageButton(page, RW.tryAgain)).toHaveCount(0);
    await expect(main(page).locator('.pp-skeleton')).toHaveCount(0);
    expect(record!.reads('cand-nobody').at(-1)!.status).toBe(404);
  });

  for (const [label, how] of [['a 500', { status: 500 }], ['a 503', { status: 503 }], ['a 403', { status: 403, body: { error: 'Forbidden' } }], ['a dropped connection', { abort: true }]] as const) {
    test(`AC-R10 ${label} shows "This candidate could not be loaded." with "Try again", which reads once more`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
      const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
      const { page, record } = fx;
      await asRecruiter(fx);
      record!.refuse({ ...how });
      await openRecord(page, BONGANI);
      await expect(main(page).getByText(RW.failed, { exact: true })).toBeVisible();
      await expect(main(page).getByText(RW.notFound, { exact: true })).toHaveCount(0);
      await expect(personHeader(page)).toHaveCount(0);
      await expect(pathList(page)).toHaveCount(0);
      await quiet(page);
      const before = record!.reads(BONGANI).length;
      await pageButton(page, RW.tryAgain).click();
      await expect.poll(async () => (await personHeader(page).count()) && (await readHeader(page)).name).toBe('Bongani Mthembu');
      await quiet(page);
      expect(record!.reads(BONGANI).length - before, 'Try again reads once').toBe(1);
      await expect(main(page).getByText(RW.failed, { exact: true })).toHaveCount(0);
    });
  }
});

// ================================================================ AC-R11 Who may open it (R-1, safety)
/** REC-UI-04's approvers, as support/rec-ui-04/offers-fake.ts has them (P.approver, P.approverHr), built on WHO's company A people. */
const approverOf = (base: Who, local: string, given: string, family: string, groups: string[]): Who =>
  ({ ...base, email: `${local}@${base.email.split('@')[1]}`, givenName: given, familyName: family, groups, full: `${given} ${family}` });
const OFFER_APPROVER = approverOf(WHO.employeeA, 'sipho.ndlovu', 'Sipho', 'Ndlovu', ['employee', 'perm-approve-offers']);
const OFFER_APPROVER_HR = approverOf(WHO.hrNoTickA, 'precious.mwale', 'Precious', 'Mwale', ['hr_staff', 'perm-approve-offers']);

test.describe('AC-R11 Who may open it', () => {
  test.beforeEach(noBackendOnly);

  // The locked DENIED list of rec-ui-02.spec.ts, person for person.
  const DENIED: Array<[string, Who]> = [
    ['a Recruiter of company B (Recruitment off)', WHO.recruiterB], ['a Recruiter of company C (nothing on)', WHO.recruiterC],
    ['HR without the Recruitment tick', WHO.hrNoTickA], ['the tick without HR', WHO.tickOnlyA], ['a hiring manager', WHO.managerA],
    ['an Admin', WHO.adminA], ['an Employee', WHO.employeeA],
    // REC-UI-04's two Offers approvers (offer approve tick, no Recruitment tick): Offers only, never a candidate record (R-1).
    ['an Offers approver (Employee with the approve tick)', OFFER_APPROVER], ['an Offers approver who is HR (approve tick, no Recruitment tick)', OFFER_APPROVER_HR],
  ];
  for (const [label, who] of DENIED) {
    test(`AC-R11 ${label} is sent away from /hire/candidates/cand-… typed in the address bar and makes no Recruitment request`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
      const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
      const { page, hire, record } = fx;
      await signInAs(fx.signIn, fx.cognito, fx.modules, hire, who);
      if (who.lands) { await expect(page).toHaveURL(who.lands); await quiet(page); } else await expect(page).toHaveURL(/\/sign-in/);
      for (const id of [BONGANI, 'cand-os-1', 'cand-b1']) {
        await page.goto(`/hire/candidates/${id}`);
        await quiet(page);
        await expect(page, `${id} sends them away`).not.toHaveURL(/\/hire\//);
        if (who.lands) await expect(page).toHaveURL(who.lands); else await expect(page).toHaveURL(/\/sign-in/);
        expect(await page.content()).not.toContain('Bongani');
      }
      expect([...hire!.recruitmentCalls, ...record!.requests].map((c) => `${c.method} ${c.path}`), 'no request to a Recruitment route').toEqual([]);
    });
  }

  test('AC-R11 A Recruiter whose company has Recruitment switched off since is sent away from the record and the record is not read', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, modules, record } = fx;
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    const before = record!.requests.length;
    modules!.answers.A = ['onboarding'];
    await page.goto(`/hire/candidates/${BONGANI}`);
    await quiet(page);
    await expect(page).not.toHaveURL(/\/hire\//);
    expect(record!.requests.length, 'no record read after the switch').toBe(before);
    expect(await page.content()).not.toContain('Bongani');
  });
});

// ================================================================ AC-R12 Company walk (R-11, safety)
test.describe('AC-R12 Company walk', () => {
  test.beforeEach(noBackendOnly);

  test('AC-R12 A Recruiter of company B (Recruitment switched on for this test) typing A\'s candidate id sees only "This candidate could not be found."; B\'s own record opens', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, modules, record } = fx;
    modules!.answers.B = ['onboarding', 'recruitment'];
    await asRecruiter(fx, WHO.recruiterB);
    for (const id of [BONGANI, 'cand-kagiso', 'cand-os-1']) {
      await openRecord(page, id);
      await expect(main(page).getByText(RW.notFound, { exact: true })).toBeVisible();
      await expect(personHeader(page)).toHaveCount(0);
      await quiet(page);
      const html = await page.content();
      for (const n of ['Bongani', 'Mthembu', 'Kagiso', 'Mpho Sithole', 'Fleet controller']) expect(html, `${id}: ${n}`).not.toContain(n);
      expect(await page.title()).not.toMatch(/Bongani|Kagiso|Mpho/);
      const last = record!.reads(id).at(-1)!;
      expect([last.email, last.status]).toEqual([WHO.recruiterB.email, 404]);
    }
    await openRecord(page, 'cand-b1');
    expect((await readHeader(page)).name).toBe('Hlengiwe Sibiya');
  });

  test('AC-R12 A\'s Recruiter signs out with the app\'s Sign out and B\'s Recruiter signs in on the page the app left (no reload, no goto): nothing of A at any moment, B\'s record answer held then shown, and A\'s id reached inside the app shows "This candidate could not be found." (G-3, S6)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, signIn, cognito, modules, hire, record } = fx;
    record!.set(BONGANI, { phone: '082 111 2233', location: 'Pietermaritzburg' });
    const aWords = ['Bongani', 'Mthembu', 'bongani.mthembu@example.org', '082 111 2233', 'Pietermaritzburg', 'Fleet controller'];
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    expect((await readHeader(page)).name).toBe('Bongani Mthembu');
    // The app's own Sign out, not a test wipe.
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    // From here on, any trace of A in the page or the tab title is written down the moment it appears.
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
    // B opens Candidates from the side menu and one of B's rows, with B's record answer held.
    record!.refuse({ hold: true, id: 'cand-b1' });
    await openNav(page);
    await page.locator('pp-side-navigation a.pp-side-navigation__item[href="/hire/candidates"]').filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/hire\/candidates$/);
    await either(main(page), 'Open Hlengiwe Sibiya').click();
    await expect.poll(() => record!.heldCount).toBe(1);
    await page.waitForTimeout(500);
    expect(await seenA(), 'nothing of A while B\'s answer is on its way').toEqual([]);
    expect(await page.title(), 'the tab title while B\'s answer is on its way').toBe(RW.titleLoading);
    await expect(personHeader(page)).toHaveCount(0);
    record!.release();
    await expect.poll(async () => (await personHeader(page).count()) && (await readHeader(page)).name).toBe('Hlengiwe Sibiya');
    expect(await seenA(), 'nothing of A on B\'s record').toEqual([]);
    // A's record address reached inside the app, as the browser's Back button does: no reload. Its answer is held too.
    record!.refuse({ hold: true, id: BONGANI });
    await page.evaluate((id) => { history.pushState({}, '', `/hire/candidates/${id}`); dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, BONGANI);
    await expect.poll(() => record!.heldCount).toBe(1);
    await page.waitForTimeout(500);
    expect(await seenA(), 'nothing of A while the answer for A\'s id is on its way').toEqual([]);
    record!.release();
    await expect(main(page).getByText(RW.notFound, { exact: true })).toBeVisible();
    await expect(personHeader(page)).toHaveCount(0);
    await quiet(page);
    expect(await seenA(), 'nothing of A at any moment').toEqual([]);
    const last = record!.reads(BONGANI).at(-1)!;
    expect([last.email, last.status]).toEqual([WHO.recruiterB.email, 404]);
  });

  test('AC-R12 No request carries a company id: opening records, moving and recording Not hired send only the token', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire, record } = fx;
    await asRecruiter(fx);
    await openRecord(page, 'cand-amahle');
    await pageButton(page, RW.move).click();
    const d = moveDialog(page, 'Amahle Dlamini');
    await chooseStage(d, 'Screening');
    await reason(d).fill('Phone screen booked');
    await moveButton(d).click();
    await expect.poll(async () => (await readPath(page)).find((s) => s.state === 'current')?.label).toBe('Screening');
    await openRecord(page, BONGANI);
    await pageButton(page, RW.notHired).click();
    const nh = page.getByRole('dialog', { name: 'Bongani not hired', exact: true });
    await nh.getByRole('radio', { name: 'Did not attend', exact: true }).check();
    await nh.getByRole('button', { name: RW.recordNotHired, exact: true }).click();
    await expect.poll(async () => (await readHeader(page)).lozenge?.words).toBe(RW.notHired);
    await openRecord(page, 'cand-os-1');
    const all = [...hire!.recruitmentCalls, ...record!.requests];
    expect(record!.requests.length).toBeGreaterThanOrEqual(5);
    for (const c of all) expect(companyIdIn(c), `${c.method} ${c.path}`).toEqual([]);
    for (const c of all) for (const id of Object.values(COMPANY_ID)) expect(c.raw).not.toContain(id);
    for (const c of record!.requests) expect(c.query, 'the record read sends no query').toEqual({});
  });
});

// ================================================================ AC-R13 Phone (R-12)
test.describe('AC-R13 Phone', () => {
  test.beforeEach(noBackendOnly);
  test.beforeEach(() => phoneOnly('the criterion is the 390 wide screen'));

  async function everythingReachable(page: Page, where: string): Promise<void> {
    const problems = await page.evaluate(async () => {
      const out: string[] = [];
      const width = document.documentElement.clientWidth;
      const bar = document.querySelector('pp-top-navigation')?.getBoundingClientRect();
      const sel = ['h1', 'h2', 'h3', '[role="heading"]', 'button', 'a[href]', '[role="tab"]', '.pp-lozenge', '.pp-progress-tracker__step', '.pp-breadcrumbs li', 'dt', 'dd', '.pp-section-message', '.pp-person-header__role', '.pp-person-header__fact']
        .map((s) => `main ${s}`).join(',');
      const targets = [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert],[hidden],[aria-hidden="true"]') && !el.closest('.pp-visually-hidden');
      });
      for (const el of targets) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = el.getBoundingClientRect();
        const label = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
        if (r.left < -1 || r.right > width + 1) out.push(`${label} is cut off sideways (${Math.round(r.left)} to ${Math.round(r.right)})`);
        if (bar && r.top < bar.bottom - 1 && r.bottom > 0) out.push(`${label} is under the top bar`);
        if (!['BUTTON', 'A'].includes(el.tagName) && el.getAttribute('role') !== 'tab') continue;
        const x = Math.min(Math.max(r.left + r.width / 2, 1), width - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        if (hit && !el.contains(hit) && !hit.contains(el)) out.push(`${label} is covered by ${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}`);
      }
      window.scrollTo(0, 0);
      if (document.documentElement.scrollWidth > width + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide)`);
      return out;
    });
    expect(problems, where).toEqual([]);
  }

  test('AC-R13 The record at 390: breadcrumb, name, lozenge, Not hired and Move, the path, the tab strip and both cards are visible, not under the top bar, and nothing scrolls sideways', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire, record } = fx;
    kitBongani(hire!, record!);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await quiet(page);
    for (const [what, loc] of [
      ['breadcrumb', main(page).locator('.pp-breadcrumbs').first()], ['name', personHeader(page).locator('.pp-person-header__name')], ['lozenge', personHeader(page).locator('.pp-lozenge')],
      ['Not hired', pageButton(page, RW.notHired)], ['Move', pageButton(page, RW.move)], ['path', pathList(page)], ['tab strip', main(page).getByRole('tablist')],
      ['Next step', nextStepCard(page)], ['Candidate details', detailsCard(page)],
    ] as const) await expect(loc, what).toBeVisible();
    await everythingReachable(page, 'the record');
  });

  test('AC-R13 The not-found and failed states at 390 are reachable too', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, record } = fx;
    await asRecruiter(fx);
    await openRecord(page, 'cand-nobody');
    await everythingReachable(page, 'not found');
    record!.refuse({ status: 500 });
    await openRecord(page, BONGANI);
    await expect(main(page).getByText(RW.failed, { exact: true })).toBeVisible();
    await everythingReachable(page, 'failed');
  });
});

// ================================================================ AC-R14 Kit match and words (R-13, G-2)
test.describe('AC-R14 Kit match and words', () => {
  test.beforeEach(noBackendOnly);

  const DS = join(__dirname, '..', '..', 'src', 'styles', 'design-system');
  const known = (): Set<string> => new Set(['components.css', 'tokens/base.css'].flatMap((f) => readFileSync(join(DS, f), 'utf8').match(/\.pp-[a-z0-9_-]+/g) ?? []).map((c: string) => c.slice(1)));
  type Screen = (typeof RECORD_KIT.screens)['Candidate: overview'];
  const kit = (): Screen => RECORD_KIT.screens[phone() ? 'Candidate: overview (phone)' : 'Candidate: overview'] as Screen;
  // Layout helpers and avatar colours; and what this step does not build (R-13): the tab count, More actions (the icon button), the
  // Next step card's footer with "Go to interviews", and the Batsi note (pp-section-message--agent and its pp-link).
  const SKIP = [/^pp-gap-/, /^pp-inline/, /^pp-stack$/, /--inline$/, /^pp-avatar--(?!xlarge$)/, /^pp-text(--|$)/, /^pp-measure-/];
  const LATER = [/^pp-tabs__count$/, /^pp-button--icon$/, /^pp-section-message--agent$/, /^pp-link$/, /^pp-card__footer$/];

  async function classesOf(scope: Locator): Promise<Set<string>> {
    return new Set(await scope.evaluate((root) => [...new Set([root, ...root.querySelectorAll('*')].flatMap((el) => [...el.classList]).filter((c) => c.startsWith('pp-')))]));
  }
  const missing = (kitList: readonly string[], have: Set<string>, extra: RegExp[] = []) => kitList.filter((c) => !have.has(c) && ![...SKIP, ...LATER, ...extra].some((re) => re.test(c)));

  async function onlyPp(page: Page, where: string): Promise<void> {
    const have = known();
    const found = await main(page).evaluate((el) => ({
      classes: [...new Set([el, ...el.querySelectorAll('*')].flatMap((e) => [...e.classList]).filter((c) => c.startsWith('pp-')))],
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

  test('AC-R14 The app stays synced at 449bc5b and the kit was read at 4dac7bb (G-2): no design system update in this step', async () => {
    const sync = JSON.parse(readFileSync(join(DS, 'sync.json'), 'utf8')) as { ref: string };
    expect(sync.ref, 'a design system change needs these structures captured again (a child lock)').toBe(RECORD_KIT.syncRef);
    expect(RECORD_KIT.ref).toBe('4dac7bb9d6647fc30026dccd6f4e68e0c67d4927');
    expect(RECORD_KIT.syncRef).toBe('449bc5bce60d77099c4d539ea36f3b2440ab094b');
  });

  test('AC-R14 The record matches "Candidate: overview" (and its phone frame): breadcrumbs, person header, path, tabs, both cards and the page; only design system parts', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire, record } = fx;
    kitBongani(hire!, record!);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await quiet(page);
    const k = kit();
    expect(missing(k.main, await classesOf(main(page))), 'page: classes the kit has and the page lacks').toEqual([]);
    expect(missing(k.breadcrumbs, await classesOf(main(page).locator('.pp-breadcrumbs').first())), 'breadcrumbs').toEqual([]);
    expect(missing(k.header, await classesOf(personHeader(page))), 'person header').toEqual([]);
    expect(missing(k.path, await classesOf(pathList(page))), 'path').toEqual([]);
    expect(missing(k.tabs, await classesOf(main(page).locator('.pp-tabs').first())), 'tabs').toEqual([]);
    expect(missing(k.nextStep, await classesOf(nextStepCard(page)), [/^pp-button/]), 'Next step card').toEqual([]);
    expect(missing(k.details, await classesOf(detailsCard(page))), 'Candidate details card').toEqual([]);
    // The kit's own labels and order for the details card and its title.
    expect(k.detailsWords.filter((w) => (RW.detailLabels as readonly string[]).includes(w))).toEqual([...RW.detailLabels]);
    expect(k.nextStepWords.slice(0, 2)).toEqual([RW.nextStep, fromTo('INTERVIEW', 'OFFER')]);
    await onlyPp(page, 'the record');
  });

  test('AC-R14 No record page, state or dialog uses an old word: Masked, Rejected, Evaluation, Provisioning, sentiment', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r });
    const { page, hire, record } = fx;
    addCand(hire!, { id: 'cand-hired-1', name: 'Sibusiso Khoza', stage: 'HIRED', stage_entered_at: iso(now(hire!) - 3 * DAY) });
    await asRecruiter(fx);
    const texts: string[] = [];
    for (const id of [BONGANI, 'cand-amahle', 'cand-kagiso', 'cand-hired-1', 'cand-nomvula', 'cand-os-1', 'cand-nobody']) {
      await openRecord(page, id);
      await quiet(page);
      texts.push(`${await page.locator('body').innerText()} ${await page.title()}`);
    }
    await openRecord(page, BONGANI);
    await pageButton(page, RW.notHired).click();
    texts.push(await page.locator('body').innerText());
    await page.keyboard.press('Escape');
    record!.refuse({ status: 500 });
    await openRecord(page, BONGANI);
    texts.push(await main(page).innerText());
    for (const t of texts) expect(t).not.toMatch(OLD_WORDS);
  });
});

// ================================================================ AC-R15 pepla-dev (judged after merge)
test.describe('AC-R15 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-R15 runs on pepla-dev only.');

  test('AC-R15 @pepla-dev The HR login opens the seeded Interview candidate from Candidates: name, role line with the department\'s name, Interview current, and the blocked Next step', async ({ page, signIn, hr }) => {
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto('/hire/candidates');
    await expect(table(page)).toBeVisible();
    await either(main(page), 'Open Bongani Mthembu').first().click();
    await expect(page).toHaveURL(/\/hire\/candidates\/[^/]+$/);
    const h = await readHeader(page);
    expect(h.name).toBe('Bongani Mthembu');
    expect(h.role.startsWith('Fleet controller · Operations'), `role line "${h.role}"`).toBe(true);
    expect((await readPath(page)).find((s) => s.state === 'current')?.label).toBe('Interview');
    const n = await readNextStep(page);
    expect(n?.subtitle).toBe(fromTo('INTERVIEW', 'OFFER'));
    expect(n?.messages.map((m) => m.body)).toEqual([RW.blockedBody]);
    test.info().annotations.push({ type: 'record', description: page.url() });
  });

  test('AC-R15 @pepla-dev Company B\'s HR login typing that id sees "This candidate could not be found." if B has Recruitment on, or is sent away if off; nothing of A either way', async ({ page, signIn, hr }) => {
    const email = process.env['E2E_B_HR_EMAIL'], password = process.env['E2E_B_HR_PASSWORD'];
    test.skip(!email || !password, 'E2E_B_HR_EMAIL and E2E_B_HR_PASSWORD are not set: the company B part cannot run.');
    // A's id, read as A.
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto('/hire/candidates');
    await either(main(page), 'Open Bongani Mthembu').first().click();
    await expect(page).toHaveURL(/\/hire\/candidates\/[^/]+$/);
    const aUrl = new URL(page.url()).pathname;
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await signIn.open();
    await signIn.signInAs({ email: email!, password: password! });
    await expect(page).toHaveURL('/hr');
    await openNav(page);
    const recruitmentOn = (await navLabels(page)).includes('Candidates');
    await page.goto(aUrl);
    await quiet(page);
    if (recruitmentOn) await expect(main(page).getByText(RW.notFound, { exact: true })).toBeVisible();
    else await expect(page).toHaveURL('/hr');
    const html = await page.content();
    for (const n of ['Bongani', 'Mthembu']) expect(html).not.toContain(n);
  });
});
