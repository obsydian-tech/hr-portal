import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { ON_DEV, avatarButton, type SignInPage } from './support/fixtures';
import type { CognitoFake } from './support/cognito-fake';
import type { ModulesFake } from './support/mod-02/modules-fake';
import { WHO, companyIdIn, enter, iso, quiet, watchErrors, type HireFake, type Who } from './support/rec-ui/harness';
import { RW, personHeader, readPath, type RecordFake } from './support/rec-ui-02/record';
import type { EventsFake } from './support/rec-ui-02/notes';
import { IW, inApp, interviewsDrawn, iv, readRows, rowsOf, voted, chosenOf, type InterviewsFake, type Iv } from './support/int-ui/interviews';
import { bookedIv, drawerOf as scheduleDrawerOf, anyDrawer, type ScheduleFake } from './support/int-ui/schedule';
import type { CloseFake } from './support/int-ui/close';
import type { VoteFake } from './support/rec-ui-03/capture';
import { blockOf, blockText, entry, expect, legacyVote, main, newVote, readBlock, rowText, test, type Entry, type ScoresFake } from './support/int-ui/summary';
import { chooseStage, chosenStage, dialog as moveDialog, moveButton, reason } from './support/ang-01/gallery';
import {
  BAD, CHOICES, DW, SUMMARY_WORDS, addressOf, anyDecide, cancelOf, choice, confirmOf, decideButton, decideLink, decideOf, drawerOf, groupOf, historyLength,
  lineOf, phoneTitle, pressDecide, readChoices, requiredLine, titleOf, wordsOf,
} from './support/int-ui/decide';

/**
 * INT-UI-06 · Decide: a Recruiter on a candidate at the Interview stage presses "Decide", reads the panel scores in the Decide drawer
 * (a full page on a phone), and picks Move to Offer, Book another interview or Not hired; each choice goes on to the move, the booking or
 * the Not hired step that already exists. Jira NH-275 (epic NH-223, amber). Lock acceptance-lock/int-ui-06 (one squashed commit on
 * develop). Spec: specs/interview-journey/cards/INT-UI-06.md, section "Changes after spec check round 1 (28 Nov)" (R-1 to R-4, O-1 to O-9,
 * final AC-1 to AC-11, decisions D1 to D10). Where the spec is silent, cards/int-ui-06.md says what these tests take (T-D1 up).
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is the harness's (19 Nov 2026 10:00 in Johannesburg).
 * AC-11 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 *
 * Planned green before the build (they guard against a page that does too much, so they pass on develop where nothing is drawn):
 * AC-1 "no Decide where the record does not allow it", AC-7 "no Decide control without the header button" and the no-request half of
 * AC-8. Every other test fails on develop.
 */

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');
const desktopOnly = (why: string) => test.skip(test.info().project.name !== 'desktop-1280', `Desktop only: ${why}`);
const phoneOnly = (why: string) => test.skip(test.info().project.name !== 'phone-390', `Phone only: ${why}`);
const isPhone = () => test.info().project.name === 'phone-390';

type Fx = {
  page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null; record: RecordFake | null;
  events: EventsFake | null; interviews: InterviewsFake | null; sched: ScheduleFake | null; closer: CloseFake | null; voter: VoteFake | null; scores: ScoresFake | null;
};

const SAVE_FAIL = RW.saveFail;
const BONGANI = 'cand-bongani';
const NAME = 'Bongani Mthembu';
const ROLE = 'Fleet controller';
const B_CAND = 'cand-b2';
const B_NAME = 'Mandla Cele';
const sast = (day: number, hh: number, mm = 0) => iso(Date.UTC(2026, 10, day, hh - 2, mm));
const SIPHO_V = () => voted('Sipho Ndlovu', 'YES', 4, null, { person_id: 'sub-a-sipho' });
const LERATO_V = () => voted('Lerato Mokoena', 'NO', 2.5, 'Thandi Dube', { person_id: 'sub-a-lerato' });
const doneIv = (id: string, day: number, extra: Partial<Iv> = {}): Iv => iv(id, sast(day, 10), 'COMPLETED', { type: 'TECHNICAL', panel: [SIPHO_V(), LERATO_V()], ...extra });
const CRIT: Array<[string, string, number]> = [['forklift_safety', 'Forklift safety', 3.7], ['route_planning', 'Route planning', 3], ['customer_care', 'Talks to customers', 4.3]];
const CRIT_ROWS: Array<[string, string]> = [['Forklift safety', '3.7'], ['Route planning', '3.0'], ['Talks to customers', '4.3']];
const LABELS = CRIT.map((c) => c[1]).concat('Teamwork');
const fullEntry = (id: string, split = false): Entry => entry(id, CRIT, 3.4, split, [newVote('YES'), newVote('NO'), newVote('YES'), legacyVote('STRONG_NO')]);
const FULL_TEXT = (split = false) => blockText({ split, overall: '3.4', decisions: '2 Yes · 1 No', rows: CRIT_ROWS });
const small = (id: string, overall: number, split: boolean, votes = [newVote('YES')]): Entry => entry(id, [['teamwork', 'Teamwork', overall]], overall, split, votes);
const LIST = () => [doneIv('iv-d', 12), bookedIv('iv-b', sast(24, 10))];

const candOf = (hire: HireFake, id = BONGANI) => hire.world.cands.find((c) => c.id === id)!;
/** Every required interview done: the record sends no blocker and the move's gate is open. */
const allDone = (hire: HireFake, id = BONGANI) => { const c = candOf(hire, id); c.interviews_done = c.interviews_required ?? 0; };

async function asRecruiter(fx: Fx, who: Who = WHO.recruiterA): Promise<void> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
}
async function openAt(page: Page, id: string, query = ''): Promise<void> {
  await page.goto(`/hire/candidates/${id}${query}`);
  await expect(personHeader(page).or(main(page).getByText(IW.notFound, { exact: true })).or(anyDecide(page)).first()).toBeVisible();
}
/** Gives Bongani the list and scores, signs in as A's Recruiter and opens the record (Overview unless a query says otherwise). */
async function onRecord(fx: Fx, query = '', list: Iv[] = LIST(), entries: Entry[] = [fullEntry('iv-d')], required = { done: 2, total: 3 }): Promise<void> {
  fx.scores!.set(BONGANI, entries);
  fx.sched!.set(BONGANI, list, required);
  await asRecruiter(fx);
  await openAt(fx.page, BONGANI, query);
}
/** Opens Decide from the Overview and waits for the summary to draw (desktop) or the overall (phone). */
async function openReady(fx: Fx): Promise<Locator> {
  await onRecord(fx);
  await quiet(fx.page);
  const d = await pressDecide(fx.page, NAME);
  await quiet(fx.page);
  return d;
}
/** The "Panel scores" block inside the desktop drawer: its text as a person reads it. */
async function drawerBlockText(d: Locator): Promise<string> {
  const g = d.getByRole('group', { name: SUMMARY_WORDS.heading, exact: true });
  await expect(g, 'one "Panel scores" block in the drawer').toHaveCount(1);
  return g.evaluate((el) => {
    const c = el.cloneNode(true) as HTMLElement;
    c.querySelectorAll('[aria-hidden="true"], svg, .pp-visually-hidden').forEach((x) => x.remove());
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    while (w.nextNode()) parts.push(w.currentNode.nodeValue ?? '');
    return parts.join(' ').replace(/[\s  ]+/g, ' ').trim();
  });
}
/** Decide is closed: no drawer, no Decide page, at most the tab's own one "Panel scores" block in main (rule 9). */
async function closed(page: Page, where: string): Promise<void> {
  await expect(anyDecide(page), `${where}: Decide is closed`).toHaveCount(0);
  await expect(main(page).locator('pp-drawer, .pp-drawer'), `${where}: no pp-drawer in main`).toHaveCount(0);
  await expect(page.locator('.pp-drawer[role="dialog"]').filter({ hasText: /^Decide on / }), `${where}: no Decide drawer anywhere`).toHaveCount(0);
  expect(await page.getByRole('group', { name: SUMMARY_WORDS.heading, exact: true }).count(), `${where}: no second "Panel scores" block`).toBeLessThanOrEqual(1);
}
const shownPut = (hire: HireFake) => hire.to('PUT', /\/stage$/);
const shownPost = (hire: HireFake) => hire.to('POST', /\/not-hired/);

// ================================================================ AC-1 The button
test.describe('AC-1 The button', () => {
  test.beforeEach(noBackendOnly);

  test('AC-1 "Decide" shows in the person header exactly when can_decide is true and the stage is Interview; then it is the header\'s one primary button, after Not hired and Move, and Move is a default button; on the Overview it is the only primary button in main', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    await asRecruiter(fx);
    await openAt(page, BONGANI);
    await quiet(page);
    await expect(decideButton(page)).toBeVisible();
    const head = await personHeader(page).locator('.pp-person-header-actions, pp-person-header-actions').first().evaluate((el) =>
      [...el.querySelectorAll('button, a[href]')].map((b) => ({ name: (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim(), primary: b.classList.contains('pp-button--primary') })));
    expect(head.map((b) => b.name), 'header order: Not hired, Move, Decide').toEqual([DW.notHired, 'Move', DW.decide]);
    expect(head.filter((b) => b.primary).map((b) => b.name), 'the header\'s one primary button is Decide').toEqual([DW.decide]);
    const primaries = await main(page).locator('.pp-button--primary').evaluateAll((bs) => bs.map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim()));
    expect(primaries, 'on the Overview Decide is the only primary button in main').toEqual([DW.decide]);
  });

  test('AC-1 (green before the build by design) No Decide for can_decide false at Interview, nor at Applied, Screening, Offer, Hired or Not hired with can_decide true; there the page is as today: Move is primary wherever it shows', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    hire!.world.cands.push({ ...candOf(hire!, 'cand-kagiso'), id: 'cand-hired-6', name: 'Sibusiso Khoza', stage: 'HIRED' });
    await asRecruiter(fx);
    const cases: Array<[string, Parameters<RecordFake['set']>[1]]> = [
      [BONGANI, { can_decide: false }], ['cand-amahle', { can_decide: true }], ['cand-tariro', { can_decide: true }], ['cand-kagiso', { can_decide: true }],
      ['cand-hired-6', { can_decide: true, can_move: false }], ['cand-nomvula', { can_decide: true, can_move: false }],
    ];
    for (const [id, x] of cases) {
      record!.set(id, x);
      await openAt(page, id);
      await quiet(page);
      const where = `${id} ${JSON.stringify(x)}`;
      await expect(decideButton(page), `${where}: no Decide`).toHaveCount(0);
      await expect(main(page).getByRole('button', { name: DW.decide, exact: true }), `${where}: no Decide anywhere`).toHaveCount(0);
      const move = personHeader(page).getByRole('button', { name: 'Move', exact: true });
      if (await move.count()) await expect(move, `${where}: Move stays primary`).toHaveClass(/pp-button--primary/);
    }
  });

  test('AC-1 On the Interviews tab the header still has Decide as its one primary button and Move as default, and the tab\'s own "Schedule an interview" keeps its primary look (D8)', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    await onRecord(fx, '?tab=interviews&interview=iv-d');
    await interviewsDrawn(page);
    await quiet(page);
    await expect(decideButton(page)).toHaveClass(/pp-button--primary/);
    await expect(personHeader(page).locator('.pp-button--primary'), 'one primary in the header').toHaveCount(1);
    await expect(personHeader(page).getByRole('button', { name: 'Move', exact: true })).not.toHaveClass(/pp-button--primary/);
    const schedule = main(page).getByRole('button', { name: 'Schedule an interview', exact: true }).first();
    await expect(schedule).toBeVisible();
    await expect(schedule, 'Schedule an interview stays primary').toHaveClass(/pp-button--primary/);
  });
});

// ================================================================ AC-2 Opening and the address
test.describe('AC-2 Opening and the address', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2 Pressing Decide on the Overview chooses the Interviews tab and opens Decide; the address holds tab=interviews and decide=1 with no new history entry; Cancel closes it, removes decide and puts focus on Decide; nothing is sent', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    await onRecord(fx);
    await quiet(page);
    await closed(page, 'before');
    const before = await historyLength(page);
    const d = await pressDecide(page, NAME);
    await expect.poll(async () => (await addressOf(page)).get('decide'), { message: 'decide=1 in the address' }).toBe('1');
    expect((await addressOf(page)).get('tab')).toBe('interviews');
    expect(await historyLength(page), 'no new history entry').toBe(before);
    if (!isPhone()) await expect(main(page).getByRole('tab', { name: 'Interviews' })).toHaveAttribute('aria-selected', 'true');
    await cancelOf(d).click();
    await closed(page, 'after Cancel');
    await expect.poll(async () => (await addressOf(page)).has('decide'), { message: 'decide is removed' }).toBe(false);
    expect((await addressOf(page)).get('tab')).toBe('interviews');
    await expect(main(page).getByRole('tab', { name: 'Interviews' }), 'back on the record, on the Interviews tab').toHaveAttribute('aria-selected', 'true');
    await expect(decideButton(page), 'focus returns to Decide').toBeFocused();
    expect(await historyLength(page)).toBe(before);
    await quiet(page);
    expect(shownPut(hire!).length + shownPost(hire!).length, 'nothing sent').toBe(0);
  });

  test('AC-2 Escape and the drawer\'s Close button each close Decide, remove decide and return focus to Decide', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    desktopOnly('the phone page has no drawer to close; Cancel closes it (first AC-2 test)');
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    await onRecord(fx);
    await quiet(page);
    for (const how of ['Escape', 'Close'] as const) {
      const d = await pressDecide(page, NAME);
      if (how === 'Escape') await page.keyboard.press('Escape');
      else await d.getByRole('button', { name: DW.close, exact: true }).click();
      await closed(page, how);
      await expect.poll(async () => (await addressOf(page)).has('decide'), { message: `${how}: decide is removed` }).toBe(false);
      await expect(decideButton(page), `${how}: focus returns to Decide`).toBeFocused();
    }
  });

  test('AC-2 Opening ?tab=interviews&decide=1 opens Decide only once the record and the interviews read have both answered; a reload of the same address opens it again', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    fx.scores!.set(BONGANI, [fullEntry('iv-d')]);
    fx.sched!.set(BONGANI, LIST(), { done: 2, total: 3 });
    await asRecruiter(fx);
    interviews!.refuse({ hold: true });
    await page.goto(`/hire/candidates/${BONGANI}?tab=interviews&decide=1`);
    await expect.poll(() => interviews!.heldCount, { message: 'the interviews read is held' }).toBe(1);
    await page.waitForTimeout(500);
    await expect(anyDecide(page), 'not open while the interviews read is out').toHaveCount(0);
    interviews!.release();
    await expect(isPhone() ? phoneTitle(page, NAME) : drawerOf(page, NAME)).toBeVisible();
    expect((await addressOf(page)).get('decide')).toBe('1');
    await page.reload();
    await expect(isPhone() ? phoneTitle(page, NAME) : drawerOf(page, NAME), 'the same address opens it again').toBeVisible();
  });

  test('AC-2 decide=1 on an Offer candidate, or on an Interview candidate with can_decide false, opens nothing and is removed; decide=yes is removed and ignored', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    fx.sched!.set('cand-kagiso', [doneIv('iv-k', 10)], null);
    fx.sched!.set(BONGANI, LIST(), { done: 2, total: 3 });
    fx.sched!.set('cand-tendai', [doneIv('iv-t', 11)], { done: 1, total: 2 });
    record!.set('cand-tendai', { can_decide: false });
    await asRecruiter(fx);
    for (const [id, q] of [['cand-kagiso', 'decide=1'], ['cand-tendai', 'decide=1'], [BONGANI, 'decide=yes']] as const) {
      await openAt(page, id, `?tab=interviews&${q}`);
      await interviewsDrawn(page);
      await quiet(page);
      await closed(page, `${id} ${q}`);
      await expect.poll(async () => (await addressOf(page)).has('decide'), { message: `${id} ${q}: decide is removed` }).toBe(false);
    }
  });

  test('AC-2 While Decide is closed main holds no pp-drawer and only the tab\'s own "Panel scores" block, on the Overview and on the Interviews tab with a Done interview chosen', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    await onRecord(fx);
    await quiet(page);
    await closed(page, 'Overview');
    await openAt(page, BONGANI, '?tab=interviews&interview=iv-d');
    await interviewsDrawn(page);
    await expect(blockOf(page)).toHaveCount(1);
    await quiet(page);
    await closed(page, 'Interviews tab');
    await expect(page.getByRole('group', { name: SUMMARY_WORDS.heading, exact: true }), 'exactly one block').toHaveCount(1);
  });
});

// ================================================================ AC-3 What it shows
test.describe('AC-3 What it shows', () => {
  test.beforeEach(noBackendOnly);

  test('AC-3 Decide shows the title "Decide on {candidate}", the line "{candidate} · {role}", the chosen Done interview\'s summary (desktop: the "Panel scores" block with the tab\'s exact text; phone: the overall "{n} out of 5", the decisions line, "Split panel" and the required line), and the three choices in kit order with none checked; the confirm reads "Decide" and is disabled', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    await onRecord(fx, '?tab=interviews&interview=iv-d', LIST(), [fullEntry('iv-d', true)]);
    await interviewsDrawn(page);
    await expect(blockOf(page)).toBeVisible();
    const tabText = (await readBlock(page)).text;
    expect(tabText).toBe(FULL_TEXT(true));
    const d = await pressDecide(page, NAME);
    if (isPhone()) {
      await expect(phoneTitle(page, NAME)).toBeVisible();
      await expect(d.getByText(lineOf(NAME, ROLE), { exact: true }), 'the description line').toBeVisible();
      await expect(d.locator('.pp-scorecard__overall').first(), 'the overall').toBeVisible();
      const overall = (await d.locator('.pp-scorecard__overall').first().innerText()).replace(/\s+/g, ' ').trim();
      expect(overall, 'overall, "out of 5" and the decisions line').toBe('3.4 out of 5 2 Yes · 1 No');
      await expect(d.getByText(SUMMARY_WORDS.split, { exact: true }), '"Split panel"').toBeVisible();
      await expect(d.getByText(requiredLine(2, 3), { exact: true }), 'the required line').toBeVisible();
      await expect(d.locator('.pp-person-header'), 'the record\'s content is replaced').toHaveCount(0);
      await expect(main(page).locator(':is(ul, ol)[aria-label="Interviews"]'), 'no interview list behind it').toHaveCount(0);
    } else {
      await expect(d.locator('.pp-drawer__description')).toHaveText(lineOf(NAME, ROLE));
      expect(await drawerBlockText(d), 'the drawer\'s block reads as the tab\'s').toBe(tabText);
    }
    const ch = await readChoices(d, NAME);
    expect(ch.map((c) => c.label), 'three choices in kit order').toEqual([...CHOICES]);
    expect(ch.filter((c) => c.checked), 'none checked').toEqual([]);
    await expect(confirmOf(d)).toHaveCount(1);
    await expect(confirmOf(d)).toHaveText(DW.decide);
    await expect(confirmOf(d)).toBeDisabled();
  });

  test('AC-3 Decide shows the summary of the interview chosen on the tab, not another Done one', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const list = [doneIv('iv-d1', 12), doneIv('iv-d2', 14), bookedIv('iv-b', sast(24, 10))];
    await onRecord(fx, '?tab=interviews&interview=iv-d1', list, [fullEntry('iv-d2'), small('iv-d1', 2, false, [newVote('NO')])]);
    await interviewsDrawn(page);
    await expect.poll(async () => (await readBlock(page)).text).toBe(blockText({ split: false, overall: '2.0', decisions: '1 No', rows: [['Teamwork', '2.0']] }));
    const d = await pressDecide(page, NAME);
    if (isPhone()) {
      expect((await d.locator('.pp-scorecard__overall').first().innerText()).replace(/\s+/g, ' ').trim()).toBe('2.0 out of 5 1 No');
      await expect(d.getByText('3.4', { exact: true })).toHaveCount(0);
    } else {
      expect(await drawerBlockText(d)).toBe(blockText({ split: false, overall: '2.0', decisions: '1 No', rows: [['Teamwork', '2.0']] }));
    }
  });

  for (const [what, setup] of [
    ['loading (the scores answer held)', (s: ScoresFake) => s.refuse({ hold: true })],
    ['failed (500)', (s: ScoresFake) => s.refuse({ status: 500, once: false })],
    ['none (no entry for the chosen interview)', (s: ScoresFake) => s.set(BONGANI, [fullEntry('iv-other')])],
  ] as const) {
    test(`AC-3 Summary ${what}: Decide shows no block, no overall and no error line, and still the title and the three choices`, async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
      fx.scores!.set(BONGANI, [fullEntry('iv-d')]);
      fx.sched!.set(BONGANI, LIST(), { done: 2, total: 3 });
      setup(scores!);
      await asRecruiter(fx);
      await openAt(page, BONGANI, '?tab=interviews&interview=iv-d');
      await interviewsDrawn(page);
      await quiet(page);
      const d = await pressDecide(page, NAME);
      await quiet(page);
      await expect(d.getByRole('group', { name: SUMMARY_WORDS.heading, exact: true }), 'no block').toHaveCount(0);
      await expect(d.locator('.pp-scorecard'), 'no overall').toHaveCount(0);
      for (const w of [SUMMARY_WORDS.failed, SUMMARY_WORDS.loading, SUMMARY_WORDS.heading, SUMMARY_WORDS.tryAgain]) await expect(d.getByText(w, { exact: true }), `no "${w}"`).toHaveCount(0);
      await expect(d.locator('.pp-section-message--danger, [role="alert"]').filter({ hasText: /\S/ }), 'no error line').toHaveCount(0);
      expect((await readChoices(d, NAME)).map((c) => c.label)).toEqual([...CHOICES]);
      scores!.release();
    });
  }

  test('AC-3 (standing line 4) In the desktop drawer the title, each choice, the confirm and Cancel are whole, on screen and not covered, and the footer reads Cancel then the confirm', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    desktopOnly('the phone page is AC-10');
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    allDone(hire!);
    const d = await openReady(fx);
    await seenWhole(d.getByRole('heading', { name: titleOf(NAME), exact: true }), 'title');
    for (const c of CHOICES) await seenWhole(choice(d, c), c);
    await seenWhole(confirmOf(d), 'confirm');
    await seenWhole(cancelOf(d), 'Cancel');
    const order = await d.evaluate((el) => [...el.querySelectorAll('button')].filter((b) => (b as HTMLElement).offsetParent !== null)
      .map((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim()).filter((n) => n === 'Cancel' || n === 'Decide'));
    expect(order, 'footer: Cancel, then the confirm (T-D3)').toEqual([DW.cancel, DW.decide]);
  });
});

/** Standing line 4: present but covered, clipped or cut off. A box the person cannot scroll (overflow hidden or clip) is put back at its
 *  start and must hold the whole element (a radio is judged by its label); a box the person can scroll, and the page, are scrolled to it.
 *  Then the element is on screen and the thing at its centre is itself. Polled, because the drawer slides in (kit motion). */
async function seenWhole(l: Locator, what: string): Promise<void> {
  await expect(l, what).toBeVisible();
  await expect.poll(() => l.evaluate((el) => {
    const target = (el.tagName === 'INPUT' ? (document.querySelector(`label[for="${el.id}"]`) as HTMLElement | null) ?? el.closest('label') ?? el : el) as HTMLElement;
    const boxes: Array<{ a: HTMLElement; fixed: boolean }> = [];
    for (let a = target.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const o = cs.overflow + ' ' + cs.overflowX + ' ' + cs.overflowY;
      if (/(hidden|clip)/.test(o)) boxes.push({ a, fixed: true });
      else if (/(scroll|auto)/.test(o)) boxes.push({ a, fixed: false });
    }
    for (const { a, fixed } of boxes) if (fixed) { a.scrollTop = 0; a.scrollLeft = 0; }
    for (const { a, fixed } of boxes) {
      if (fixed) continue;
      const b = target.getBoundingClientRect(), c = a.getBoundingClientRect();
      if (b.top < c.top) a.scrollTop -= c.top - b.top; else if (b.bottom > c.bottom) a.scrollTop += Math.min(b.bottom - c.bottom, b.top - c.top);
    }
    { const b = target.getBoundingClientRect(); if (b.top < 0 || b.bottom > innerHeight) window.scrollBy(0, b.top - innerHeight / 3); }
    const b = target.getBoundingClientRect();
    const clipped = boxes.some(({ a }) => { const c = a.getBoundingClientRect(); return b.top < c.top - 0.5 || b.bottom > c.bottom + 0.5 || b.left < c.left - 0.5 || b.right > c.right + 0.5; });
    // The drawer sits above the top bar, so the top bar is judged by what is at the element's centre, not by its edge.
    const hit = document.elementFromPoint(b.left + Math.min(b.width / 2, 20), b.top + b.height / 2);
    return { clipped, onScreen: b.top >= -0.5 && b.bottom <= innerHeight + 0.5 && b.left >= -0.5 && b.right <= innerWidth + 0.5,
      mine: !!hit && (hit === target || target.contains(hit) || hit === el || el.contains(hit)) };
  }), { message: `${what}: whole, on screen, not covered`, timeout: 5000 }).toEqual({ clipped: false, onScreen: true, mine: true });
}

// ================================================================ AC-4 Move to Offer
test.describe('AC-4 Move to Offer', () => {
  test.beforeEach(noBackendOnly);

  test('AC-4 While the record\'s blocker is INTERVIEWS_INCOMPLETE "Move to Offer" is disabled with W-9d as its description; the other two are enabled', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const d = await openReady(fx);
    const ch = await readChoices(d, NAME);
    expect(ch[0], 'Move to Offer: disabled, W-9d').toEqual({ label: DW.move, description: DW.blocked, checked: false, disabled: true });
    expect(ch.slice(1).map((c) => [c.label, c.disabled, c.description]), 'the others enabled, no description').toEqual([[DW.book, false, ''], [DW.notHired, false, '']]);
    await expect(confirmOf(d)).toBeDisabled();
  });

  test('AC-4 With no blocker "Move to Offer" is enabled; picking it makes the confirm read "Move to Offer"; confirming closes Decide and opens the Move dialog with Offer chosen and an empty reason, and nothing is sent until its Move: then exactly one PUT { to: OFFER, reason } with one Idempotency-Key and no company, the record is read again, the stage is Offer and Decide is gone', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    allDone(hire!);
    const d = await openReady(fx);
    const ch = await readChoices(d, NAME);
    expect(ch[0], 'Move to Offer enabled, no description').toEqual({ label: DW.move, description: '', checked: false, disabled: false });
    await choice(d, DW.move).check();
    await expect(confirmOf(d)).toHaveText(DW.move);
    await expect(confirmOf(d)).toBeEnabled();
    await confirmOf(d).click();
    const m = moveDialog(page, NAME);
    await expect(m).toBeVisible();
    await closed(page, 'after confirm');
    expect(await chosenStage(m), 'Offer is chosen').toBe('Offer');
    await expect(reason(m), 'the reason is empty').toHaveValue('');
    await quiet(page);
    expect(shownPut(hire!), 'nothing sent before the Move dialog\'s Move').toHaveLength(0);
    await reason(m).fill('Panel agreed');
    const readsBefore = record!.reads(BONGANI).length;
    await moveButton(m).click();
    await expect.poll(async () => (await readPath(page)).find((s) => s.state === 'current')?.label, { message: 'the stage is Offer' }).toBe('Offer');
    await quiet(page);
    const put = shownPut(hire!);
    expect(put, 'exactly one PUT').toHaveLength(1);
    expect(put[0]!.path).toMatch(/\/v1\/candidates\/cand-bongani\/stage$/);
    expect(put[0]!.body).toEqual({ to: 'OFFER', reason: 'Panel agreed' });
    expect(put[0]!.idempotencyKey).toMatch(/^[\w-]{8,}$/);
    expect(companyIdIn(put[0]!)).toEqual([]);
    expect(record!.reads(BONGANI).length - readsBefore, 'the record is read once more').toBe(1);
    await expect(decideButton(page), 'Decide is gone at Offer').toHaveCount(0);
    await expect(page.getByText(SAVE_FAIL, { exact: true })).toHaveCount(0);
  });

  test('AC-4 Two moves started from Decide carry two different request keys (one key per move)', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    allDone(hire!);
    // Both moves are answered 500, so the candidate stays at Interview and Decide can be opened again for the second move.
    hire!.refuse({ method: 'PUT', path: /\/stage$/, status: 500, once: false });
    await openReady(fx);
    for (let n = 0; n < 2; n++) {
      const d = n === 0 ? decideOf(page, NAME) : await pressDecide(page, NAME);
      await choice(d, DW.move).check();
      await confirmOf(d).click();
      const m = moveDialog(page, NAME);
      await expect(m).toBeVisible();
      await reason(m).fill(`Try ${n + 1}`);
      await moveButton(m).click();
      await expect.poll(() => shownPut(hire!).length).toBe(n + 1);
      await expect(page.getByText(SAVE_FAIL, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    }
    const keys = shownPut(hire!).map((c) => c.idempotencyKey);
    expect(keys.every((k) => !!k), 'each has a key').toBe(true);
    expect(new Set(keys).size, 'two moves, two keys').toBe(2);
  });
});

// ================================================================ AC-5 The other two choices
test.describe('AC-5 The other two choices', () => {
  test.beforeEach(noBackendOnly);

  test('AC-5 "Book another interview": the confirm reads it; confirming closes Decide and opens the Schedule drawer for a new interview with schedule=new in the address; nothing is sent', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const d = await openReady(fx);
    await choice(d, DW.book).check();
    await expect(confirmOf(d)).toHaveText(DW.book);
    const before = sched!.calls.filter((c) => c.kind === 'book').length;
    await confirmOf(d).click();
    await expect(scheduleDrawerOf(page), 'the Schedule drawer for a new interview').toBeVisible();
    await expect(anyDecide(page)).toHaveCount(0);
    await expect.poll(async () => (await addressOf(page)).get('schedule')).toBe('new');
    expect((await addressOf(page)).has('decide'), 'decide is gone').toBe(false);
    await quiet(page);
    expect(sched!.calls.filter((c) => c.kind === 'book').length - before, 'no booking sent').toBe(0);
    expect(shownPut(hire!).length + shownPost(hire!).length).toBe(0);
  });

  test('AC-5 "Not hired": the confirm reads it; confirming closes Decide and opens the existing Not hired dialog; nothing is sent until that dialog records it', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const d = await openReady(fx);
    await choice(d, DW.notHired).check();
    await expect(confirmOf(d)).toHaveText(DW.notHired);
    await confirmOf(d).click();
    const nh = page.getByRole('dialog', { name: 'Bongani not hired', exact: true });
    await expect(nh).toBeVisible();
    await expect(anyDecide(page)).toHaveCount(0);
    await quiet(page);
    expect(shownPost(hire!), 'no Not hired request by itself').toHaveLength(0);
    await nh.getByRole('radio', { name: 'Salary did not match', exact: true }).check();
    await nh.getByRole('button', { name: 'Record not hired', exact: true }).click();
    await expect.poll(() => shownPost(hire!).length).toBe(1);
    expect(shownPost(hire!)[0]!.body).toEqual({ reason: 'SALARY_MISMATCH' });
  });

  test('AC-5 Picking each choice in turn and then Cancel sends nothing at all and changes nothing', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    allDone(hire!);
    const d = await openReady(fx);
    const before = hire!.calls.filter((c) => c.method !== 'GET' && c.method !== 'OPTIONS').length;
    const schedBefore = sched!.calls.filter((c) => c.method !== 'GET' && c.method !== 'OPTIONS').length;
    for (const c of CHOICES) { await choice(d, c).check(); await expect(confirmOf(d)).toHaveText(c); }
    await cancelOf(d).click();
    await closed(page, 'after Cancel');
    await quiet(page);
    expect(hire!.calls.filter((c) => c.method !== 'GET' && c.method !== 'OPTIONS').length - before, 'no write to the API').toBe(0);
    expect(sched!.calls.filter((c) => c.method !== 'GET' && c.method !== 'OPTIONS').length - schedBefore, 'no booking').toBe(0);
    await expect(main(page).getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /^Move |not hired$/ })).toHaveCount(0);
  });

  test('AC-5 (O-3) Opened from the Overview while the interviews read is out, "Book another interview" shows but cannot be picked, the other two can; when the read answers it can be picked; when the read fails it is not shown', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    allDone(hire!);
    await onRecord(fx);
    await quiet(page);
    interviews!.refuse({ hold: true });
    let d = await pressDecide(page, NAME);
    await expect.poll(() => interviews!.heldCount).toBe(1);
    let ch = await readChoices(d, NAME);
    expect(ch.map((c) => [c.label, c.disabled]), 'Book waits for the interviews read').toEqual([[DW.move, false], [DW.book, true], [DW.notHired, false]]);
    interviews!.release();
    await expect.poll(async () => (await readChoices(d, NAME)).map((c) => c.disabled)).toEqual([false, false, false]);
    await cancelOf(d).click();
    await closed(page, 'after Cancel');
    interviews!.refuse({ status: 500 });
    await openAt(page, BONGANI);
    await quiet(page);
    d = await pressDecide(page, NAME);
    await quiet(page);
    ch = await readChoices(d, NAME);
    expect(ch.map((c) => c.label), 'no Book after a failed interviews read').toEqual([DW.move, DW.notHired]);
  });

  test('AC-5 The flag file: the code that offers "Book another interview" reads SCHEDULE_READY from hire-flags.ts', async () => {
    desktopOnly('it checks files, not the page');
    const dir = join(__dirname, '..', '..', 'src', 'app', 'features', 'recruitment');
    const files: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(join(d, e.name)); else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) files.push(join(d, e.name)); } };
    walk(dir);
    const words = readFileSync(join(dir, 'interviews', 'interview-words.ts'), 'utf8');
    const key = /(\w+)\s*:\s*(['"`])Book another interview\2/.exec(words);
    expect(key, '"Book another interview" is a plain string under a key in interview-words.ts').toBeTruthy();
    const users = files.filter((f) => !f.endsWith('interview-words.ts') && new RegExp(`\\b${key![1]}\\b`).test(readFileSync(f, 'utf8')) && /\bdecide\b/i.test(readFileSync(f, 'utf8')));
    expect(users.length, 'some file builds the Decide choices from that word').toBeGreaterThan(0);
    const flagged = users.filter((f) => { const t = readFileSync(f, 'utf8'); return /import[^;]*\bSCHEDULE_READY\b[^;]*from\s+['"][./]*[\w/.]*hire-flags['"]/.test(t) && (t.match(/\bSCHEDULE_READY\b/g) ?? []).length >= 2; });
    expect(flagged.map((f) => f.slice(dir.length + 1)), 'the file that offers it imports and uses SCHEDULE_READY').not.toEqual([]);
  });
});

// ================================================================ AC-6 Refusals
test.describe('AC-6 Refusals', () => {
  test.beforeEach(noBackendOnly);

  /** Opens Decide with no blocker shown, picks Move to Offer, confirms, types a reason and moves. */
  async function moveFromDecide(fx: Fx): Promise<void> {
    const d = await openReady(fx);
    await choice(d, DW.move).check();
    await confirmOf(d).click();
    const m = moveDialog(fx.page, NAME);
    await expect(m).toBeVisible();
    await reason(m).fill('Panel agreed');
    await moveButton(m).click();
    await expect.poll(() => shownPut(fx.hire!).length).toBe(1);
    await expect(m).toHaveCount(0);
  }

  test('AC-6 409 INTERVIEWS_INCOMPLETE (the server\'s own gate: an interview was reopened after the record was read) shows W-9d as a danger section message and no save-failure line, and reads the record again, which then shows the blocker', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    record!.set(BONGANI, { next_step: { from: 'INTERVIEW', to: 'OFFER', blocker: null } });
    const before = () => record!.reads(BONGANI).length;
    let reads = 0;
    const d = await openReady(fx);
    reads = before();
    await choice(d, DW.move).check();
    await confirmOf(d).click();
    const m = moveDialog(page, NAME);
    await reason(m).fill('Panel agreed');
    record!.extra.delete(BONGANI);
    await moveButton(m).click();
    await expect.poll(() => shownPut(hire!).length).toBe(1);
    expect(shownPut(hire!)[0]!.status, 'the server said 409').toBe(409);
    const danger = main(page).locator('.pp-section-message--danger').filter({ hasText: DW.blocked });
    await expect(danger, 'W-9d as a danger message').toBeVisible();
    await expect(page.getByText(SAVE_FAIL, { exact: true }), 'no save-failure line').toHaveCount(0);
    await expect.poll(() => record!.reads(BONGANI).length - reads, { message: 'the record is read again' }).toBe(1);
    expect((await readPath(page)).find((s) => s.state === 'current')?.label).toBe('Interview');
    // O-2: it goes when the next Move, Not hired or Decide is pressed.
    await decideButton(page).click();
    await expect(danger, 'W-9d danger goes on the next Decide').toHaveCount(0);
  });

  test('AC-6 403 shows the save-failure line and reads the record again; with the record then saying can_decide false, Decide is gone', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    allDone(hire!);
    hire!.refuse({ method: 'PUT', path: /\/stage$/, status: 403, body: { error: 'Forbidden', code: 'FORBIDDEN' }, hold: true });
    const readsAt = { n: 0 };
    const d = await openReady(fx);
    readsAt.n = record!.reads(BONGANI).length;
    await choice(d, DW.move).check();
    await confirmOf(d).click();
    const m = moveDialog(page, NAME);
    await reason(m).fill('Panel agreed');
    await moveButton(m).click();
    await expect.poll(() => shownPut(hire!).length).toBe(1);
    record!.set(BONGANI, { can_decide: false });
    hire!.release();
    await expect(page.getByText(SAVE_FAIL, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect.poll(() => record!.reads(BONGANI).length - readsAt.n, { message: 'the record is read again' }).toBe(1);
    await expect(decideButton(page), 'Decide follows the new can_decide').toHaveCount(0);
    await expect(main(page).locator('.pp-section-message--danger').filter({ hasText: DW.blocked })).toHaveCount(0);
  });

  for (const [what, status, body] of [['409 STAGE_CHANGED', 409, { error: 'Changed', code: 'STAGE_CHANGED' }], ['500', 500, { error: 'Internal Server Error' }], ['400', 400, { error: 'Reason required', code: 'REASON_REQUIRED' }]] as const) {
    test(`AC-6 ${what} shows the save-failure line, no W-9d danger, and does not read the record again`, async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
      allDone(hire!);
      hire!.refuse({ method: 'PUT', path: /\/stage$/, status, body });
      const d = await openReady(fx);
      const reads = record!.reads(BONGANI).length;
      await choice(d, DW.move).check();
      await confirmOf(d).click();
      const m = moveDialog(page, NAME);
      await reason(m).fill('Panel agreed');
      await moveButton(m).click();
      await expect(page.getByText(SAVE_FAIL, { exact: true }).filter({ visible: true }).first()).toBeVisible();
      await quiet(page);
      expect(record!.reads(BONGANI).length - reads, 'no second record read').toBe(0);
      await expect(main(page).locator('.pp-section-message--danger').filter({ hasText: DW.blocked })).toHaveCount(0);
      await expect(decideButton(page)).toBeVisible();
    });
  }

  for (const before of ['on a fresh record', 'after Decide was opened and cancelled'] as const) test(`AC-6 The header\'s own Move keeps today\'s answers ${before}: a 409 INTERVIEWS_INCOMPLETE shows the save-failure line, no W-9d danger, and no second record read`, async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    await onRecord(fx);
    await quiet(page);
    if (before !== 'on a fresh record') {
      const d = await pressDecide(page, NAME);
      await choice(d, DW.notHired).check();
      await cancelOf(d).click();
      await closed(page, 'after Cancel');
    }
    const reads = record!.reads(BONGANI).length;
    await personHeader(page).getByRole('button', { name: 'Move', exact: true }).click();
    const m = moveDialog(page, NAME);
    await chooseStage(m, 'Offer');
    await reason(m).fill('Panel agreed');
    await moveButton(m).click();
    await expect.poll(() => shownPut(hire!).length).toBe(1);
    expect(shownPut(hire!)[0]!.status).toBe(409);
    await expect(page.getByText(SAVE_FAIL, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await quiet(page);
    await expect(main(page).locator('.pp-section-message--danger').filter({ hasText: DW.blocked }), 'no W-9d danger for the header\'s Move').toHaveCount(0);
    expect(record!.reads(BONGANI).length - reads, 'no second record read').toBe(0);
  });
});

// ================================================================ AC-7 The link under the summary
test.describe('AC-7 The link under the summary', () => {
  test.beforeEach(noBackendOnly);

  test('AC-7 With the Done interview\'s block drawn, one "Decide" control sits in the chosen interview right after the block and outside its group; it opens Decide as the header button does', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    await onRecord(fx, '?tab=interviews&interview=iv-d');
    await interviewsDrawn(page);
    await expect(blockOf(page)).toBeVisible();
    await expect(decideLink(page), 'one Decide control under the summary').toHaveCount(1);
    await expect(decideLink(page)).toBeVisible();
    const where = await decideLink(page).evaluate((el, chosenSel) => {
      const group = [...document.querySelectorAll('main [role="group"]')].find((g) => (document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent ?? '').trim() === 'Panel scores');
      const card = el.closest(chosenSel as string);
      let next: Element | null = group ?? null;
      // The first element after the block, walking out of the block's wrappers until one has a next sibling.
      while (next && !next.nextElementSibling) next = next.parentElement;
      const after = next?.nextElementSibling ?? null;
      return {
        inGroup: !!el.closest('[role="group"]'), inChosen: !!card && !!group && card.contains(group),
        follows: !!group && !!(group.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
        next: !!after && (after === el || after.contains(el)),
        primary: el.classList.contains('pp-button--primary'),
      };
    }, `main ${'.pp-card:not(:is(ul[aria-label="Interviews"], ol[aria-label="Interviews"]) *):not(:has(:is(ul[aria-label="Interviews"], ol[aria-label="Interviews"]))):not(:has(.pp-empty-state)):not(.pp-card .pp-card):not(.pp-card--sunken)'}`);
    expect(where, 'outside the group, inside the chosen interview, the next thing after the block, not a primary button').toEqual({ inGroup: false, inChosen: true, follows: true, next: true, primary: false });
    await decideLink(page).click();
    await expect(isPhone() ? phoneTitle(page, NAME) : drawerOf(page, NAME)).toBeVisible();
    expect((await addressOf(page)).get('decide')).toBe('1');
  });

  test('AC-7 (green before the build by design) No Decide control under the summary when the header has no Decide (can_decide false; Offer), nor when no block is drawn (a booked interview chosen)', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    scores!.set('cand-kagiso', [fullEntry('iv-k')]);
    sched!.set('cand-kagiso', [doneIv('iv-k', 10)], null);
    record!.set('cand-tendai', { can_decide: false });
    scores!.set('cand-tendai', [fullEntry('iv-t')]);
    sched!.set('cand-tendai', [doneIv('iv-t', 11)], { done: 1, total: 2 });
    await onRecord(fx, '?tab=interviews&interview=iv-b');
    await interviewsDrawn(page);
    await quiet(page);
    await expect(blockOf(page), 'a booked interview has no block').toHaveCount(0);
    await expect(decideLink(page), 'no block, no control').toHaveCount(0);
    for (const [id, iid] of [['cand-tendai', 'iv-t'], ['cand-kagiso', 'iv-k']] as const) {
      await openAt(page, id, `?tab=interviews&interview=${iid}`);
      await interviewsDrawn(page);
      await expect(blockOf(page), `${id}: the block shows`).toBeVisible();
      await expect(decideLink(page), `${id}: no Decide control`).toHaveCount(0);
      await expect(decideButton(page)).toHaveCount(0);
    }
  });
});

// ================================================================ AC-8 Company B and sign-in switch
test.describe('AC-8 Company B and sign-in switch', () => {
  test.beforeEach(noBackendOnly);

  test('AC-8 (no-request half green before the build by design) Company B\'s Recruiter opening A\'s candidate at ?tab=interviews&decide=1 (with and without a Done interview named) gets "This candidate could not be found.", no Decide, no scores request and nothing of A', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    scores!.set(BONGANI, [fullEntry('iv-d')]);
    sched!.set(BONGANI, LIST(), { done: 2, total: 3 });
    modules!.answers.B = ['onboarding', 'recruitment'];
    await asRecruiter(fx, WHO.recruiterB);
    for (const q of ['?tab=interviews&decide=1', '?tab=interviews&interview=iv-d&decide=1']) {
      await openAt(page, BONGANI, q);
      await expect(main(page).getByText(IW.notFound, { exact: true })).toBeVisible();
      await quiet(page);
      await expect(anyDecide(page), q).toHaveCount(0);
      await expect(page.locator('.pp-drawer'), q).toHaveCount(0);
      const html = await page.content();
      for (const a of ['Bongani', 'Forklift safety', 'Decide on']) expect(html, `${q}: nothing of A (${a})`).not.toContain(a);
    }
    expect(scores!.reads(BONGANI), 'no scores request for A\'s candidate').toHaveLength(0);
    expect(shownPut(hire!).length + shownPost(hire!).length).toBe(0);
  });

  test('AC-8 Signed in as A with Decide open, a same-tab sign-out and sign-in as B\'s Recruiter, then B\'s candidate with decide=1: nothing of A shows at any moment, B\'s own Decide shows B\'s name, and no request carries a company id', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    scores!.set(B_CAND, [small('iv-bd', 2.2, false, [newVote('NO')])]);
    sched!.set(B_CAND, [iv('iv-bd', sast(13, 10), 'COMPLETED', { type: 'FINAL', panel: [voted('Lindiwe Peters', 'NO', 2.2, null, { person_id: 'sub-b-lindiwe' })] })], { done: 1, total: 2 });
    await openReady(fx);
    await avatarButton(page).dispatchEvent('click');
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).dispatchEvent('click');
    await expect(page).toHaveURL(/\/sign-in/);
    const aWords = ['Bongani', 'Decide on Bongani', 'Forklift safety', 'Talks to customers'];
    await page.evaluate((words) => {
      const seen: string[] = [];
      (window as unknown as { __seenA: string[] }).__seenA = seen;
      const check = () => {
        const all = document.body?.innerText ?? '';
        const html = document.documentElement.outerHTML;
        for (const w of words) if (all.includes(w) || html.includes(w)) seen.push(`${w} at ${location.pathname}${location.search}`);
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
    await inApp(page, `/hire/candidates/${B_CAND}?tab=interviews&interview=iv-bd&decide=1`);
    await expect(isPhone() ? phoneTitle(page, B_NAME) : drawerOf(page, B_NAME), 'B\'s own Decide').toBeVisible();
    await quiet(page);
    await page.waitForTimeout(300);
    expect(await seenA(), 'nothing of A at any moment').toEqual([]);
    const all = [...hire!.calls, ...record!.calls, ...scores!.calls, ...interviews!.calls].filter((c) => c.method !== 'OPTIONS');
    expect(all.flatMap((c) => companyIdIn(c).map((x) => `${c.method} ${c.path}: ${x}`)), 'no company id in any request').toEqual([]);
    expect(scores!.reads(B_CAND).every((c) => c.company === 'B')).toBe(true);
  });
});

// ================================================================ AC-9 Words
test.describe('AC-9 Words', () => {
  test.beforeEach(noBackendOnly);

  const allowed = (name: string, role: string) => (w: string): boolean =>
    (Object.values(DW) as string[]).includes(w) || w === titleOf(name) || w === lineOf(name, role) || (Object.values(SUMMARY_WORDS) as string[]).includes(w)
    || LABELS.includes(w) || /^\d\.\d$/.test(w) || /^\d\.\d out of 5$/.test(w) || LABELS.some((l) => new RegExp(`^${l} \\d\\.\\d out of 5$`).test(w)) || w === rowText('Teamwork', '2.0')
    || /^(\d+ (Strong yes|Yes|No|Strong no))( · \d+ (Strong yes|Yes|No|Strong no))*$/.test(w) || /^\d+ of \d+ required interviews done$/.test(w);

  test('AC-9 Every visible string and accessible name in Decide, in every state (summary ready split and not, loading, failed, none; required missing; each choice picked), is a word of the list, a name or role from the answer, a number with one decimal, the decisions line, the required line or a criterion label; no ⟦, null, undefined, NaN or codes', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const ok = allowed(NAME, ROLE);
    const judge = (where: string, words: string[]) => {
      expect(words.length, `${where}: has words`).toBeGreaterThan(0);
      expect(words.filter((w) => !ok(w)), `${where}: only allowed words`).toEqual([]);
      expect(words.filter((w) => BAD.test(w)), `${where}: nothing broken`).toEqual([]);
    };
    const list = [doneIv('iv-d1', 12), doneIv('iv-d2', 14), bookedIv('iv-b', sast(24, 10))];
    await onRecord(fx, '?tab=interviews&interview=iv-d1', list, [fullEntry('iv-d1', true), small('iv-d2', 2, false, [newVote('NO')])]);
    await interviewsDrawn(page);
    await expect(blockOf(page)).toBeVisible();
    let d = await pressDecide(page, NAME);
    judge('ready, split, required missing', await wordsOf(d));
    for (const c of [DW.book, DW.notHired]) { await choice(d, c).check(); judge(`picked ${c}`, await wordsOf(d)); }
    await cancelOf(d).click();
    await rowsOf(page).nth(1).click();
    await expect.poll(async () => (await readBlock(page)).text).toContain('Teamwork');
    allDone(hire!);
    await openAt(page, BONGANI, '?tab=interviews&interview=iv-d2');
    await interviewsDrawn(page);
    await expect(blockOf(page)).toBeVisible();
    d = await pressDecide(page, NAME);
    await choice(d, DW.move).check();
    judge('ready, not split, Move picked', await wordsOf(d));
    await cancelOf(d).click();
    for (const [what, set] of [['loading', () => scores!.refuse({ hold: true })], ['failed', () => scores!.refuse({ status: 500 })], ['none', () => scores!.set(BONGANI, [])]] as const) {
      set();
      await openAt(page, BONGANI, '?tab=interviews&interview=iv-d1');
      await interviewsDrawn(page);
      await quiet(page);
      d = await pressDecide(page, NAME);
      judge(what, await wordsOf(d));
      await cancelOf(d).click();
      scores!.release();
    }
  });

  test('AC-9 The words table: the Decide words are plain strings in interview-words.ts; the words check passes on it and fails on a planted null row', async () => {
    desktopOnly('it checks files, not the page');
    const repo = join(__dirname, '..', '..', '..');
    const script = join(repo, 'scripts', 'ci', 'check-interview-words.mjs');
    const words = join(repo, 'pepla-web', 'src', 'app', 'features', 'recruitment', 'interviews', 'interview-words.ts');
    const text = readFileSync(words, 'utf8');
    const body = text.slice(text.indexOf('INTERVIEW_WORDS'), text.indexOf('\n};', text.indexOf('INTERVIEW_WORDS')));
    const lit = (w: string) => new RegExp(`(['"\`])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`);
    for (const w of [DW.decide, DW.move, DW.book]) expect(body, `INTERVIEW_WORDS holds "${w}" as a plain string`).toMatch(lit(w));
    expect(body, 'INTERVIEW_WORDS holds the title "Decide on {candidate}" (or "Decide on") as a plain string').toMatch(/(['"`])Decide on( \{candidate\})?\s?\1/);
    const run = (args: string[]): number => {
      try { execFileSync('node', [script, ...args], { cwd: repo, stdio: 'pipe' }); return 0; } catch (e) { return (e as { status?: number }).status ?? 1; }
    };
    expect(run([]), 'the check passes on the real table').toBe(0);
    const book = lit(DW.book).exec(body);
    expect(book).toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), 'int-ui-06-'));
    try {
      const copy = join(dir, 'interview-words.ts');
      writeFileSync(copy, text);
      expect(run([copy]), 'the check passes on an exact copy').toBe(0);
      writeFileSync(copy, text.replace(book![0], 'null'));
      expect(run([copy]), 'a planted null row fails the check').not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ================================================================ AC-10 Phone
test.describe('AC-10 Phone', () => {
  test.beforeEach(noBackendOnly);

  test('AC-10 At 390 the Decide page\'s h1, the three choices, the confirm and Cancel are each visible, not under the top bar and not covered; the confirm and Cancel are the last two controls on the page; nothing scrolls sideways', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    phoneOnly('the full-page Decide is the phone\'s');
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const errors = watchErrors(page);
    allDone(hire!);
    const d = await openReady(fx);
    const items: Array<[string, Locator]> = [['h1', phoneTitle(page, NAME)], ...CHOICES.map((c) => [c, choice(d, c)] as [string, Locator]), ['confirm', confirmOf(d)], ['Cancel', cancelOf(d)]];
    for (const [what, l] of items) {
      await l.scrollIntoViewIfNeeded();
      await expect(l, what).toBeVisible();
      const r = await l.evaluate((el) => {
        const bar = document.querySelector('.pp-top-navigation, header[role="banner"], .pp-app-shell__top');
        const top = bar ? bar.getBoundingClientRect().bottom : 0;
        const target = (el.tagName === 'INPUT' ? (document.querySelector(`label[for="${el.id}"]`) as HTMLElement | null) ?? el : el) as HTMLElement;
        const b = target.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + Math.min(b.width / 2, 20), b.top + b.height / 2);
        return { below: b.top >= top - 0.5, inside: b.right <= innerWidth + 0.5 && b.left >= -0.5, mine: !!hit && (hit === target || target.contains(hit) || hit.contains(target) || hit === el || (el as HTMLElement).contains(hit)) };
      });
      expect(r, `${what}: below the top bar, on screen, not covered`).toEqual({ below: true, inside: true, mine: true });
      await seenWhole(l, what);
    }
    const last = await main(page).evaluate((m) => [...m.querySelectorAll('button, a[href], input, select, textarea')].filter((e) => (e as HTMLElement).offsetParent !== null)
      .map((e) => (e.getAttribute('aria-label') ?? e.textContent ?? '').replace(/\s+/g, ' ').trim()).slice(-2));
    expect(last, 'the confirm and Cancel are the last two controls').toEqual([DW.decide, DW.cancel]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll').toBe(true);
    expect(errors).toEqual([]);
  });
});

// ================================================================ AC-11 pepla-dev
test.describe('AC-11 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-11 runs on pepla-dev only.');
  test.describe.configure({ retries: 0 });
  // The dev step runs every @pepla-dev test once per width and seeds once, so each width has its own pair (spec "Pepla-dev seed").
  type Cand = { candidate: string; firstName: string; lastName: string };
  type DevIds = { ready: Cand; missing: Cand };
  const ALL = JSON.parse(readFileSync(join(__dirname, 'support', 'int-ui', 'dev-ids-06.json'), 'utf8')) as Record<string, DevIds>;
  const devOf = (): DevIds => { const d = ALL[test.info().project.name]; if (!d) throw new Error(`dev-ids-06.json has no entry for ${test.info().project.name}`); return d; };
  const full = (c: Cand) => `${c.firstName} ${c.lastName}`;

  test('AC-11 @pepla-dev The company A HR login opens Ready at ?tab=interviews&decide=1: Move to Offer is enabled; the Move dialog opens with Offer, is confirmed with the reason "Dev check", and the record then shows Offer', async ({ page, signIn, hr }) => {
    const { ready } = devOf();
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto(`/hire/candidates/${ready.candidate}`);
    await expect(personHeader(page)).toBeVisible({ timeout: 20_000 });
    const stage = (await readPath(page)).find((s) => s.state === 'current')?.label;
    expect(stage, 'Ready was not reset by the seed').toBe('Interview');
    await page.goto(`/hire/candidates/${ready.candidate}?tab=interviews&decide=1`);
    const d = decideOf(page, full(ready));
    await expect(isPhone() ? phoneTitle(page, full(ready)) : drawerOf(page, full(ready))).toBeVisible({ timeout: 20_000 });
    await expect(groupOf(d, full(ready))).toBeVisible();
    await expect.poll(async () => (await readChoices(d, full(ready)))[0], { timeout: 15_000 }).toMatchObject({ label: DW.move, disabled: false });
    await choice(d, DW.move).check();
    await confirmOf(d).click();
    const m = moveDialog(page, full(ready));
    await expect(m).toBeVisible();
    expect(await chosenStage(m)).toBe('Offer');
    await reason(m).fill('Dev check');
    await moveButton(m).click();
    await expect.poll(async () => (await readPath(page)).find((s) => s.state === 'current')?.label, { timeout: 20_000 }).toBe('Offer');
    await expect(page.getByText(SAVE_FAIL, { exact: true })).toHaveCount(0);
    test.info().annotations.push({ type: 'record', description: page.url() });
  });

  test('AC-11 @pepla-dev The company A HR login opens Missing at ?tab=interviews&decide=1: Move to Offer is disabled with "Every required interview must be done first."', async ({ page, signIn, hr }) => {
    const { missing } = devOf();
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto(`/hire/candidates/${missing.candidate}?tab=interviews&decide=1`);
    const d = decideOf(page, full(missing));
    await expect(isPhone() ? phoneTitle(page, full(missing)) : drawerOf(page, full(missing))).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await readChoices(d, full(missing)))[0], { timeout: 15_000 }).toEqual({ label: DW.move, description: DW.blocked, checked: false, disabled: true });
  });

  test('AC-11 @pepla-dev Company B\'s HR login opening Ready\'s id gets "This candidate could not be found." (or is sent away when B has Recruitment off) and no Decide. It fails when E2E_B_HR_* is not set (a skip is not a pass)', async ({ page, signIn }) => {
    const { ready } = devOf();
    const email = process.env['E2E_B_HR_EMAIL'], password = process.env['E2E_B_HR_PASSWORD'];
    expect(email && password, 'E2E_B_HR_EMAIL and E2E_B_HR_PASSWORD must be set on the dev run').toBeTruthy();
    await signIn.open();
    await signIn.signInAs({ email: email!, password: password! });
    await expect(page).toHaveURL('/hr');
    await page.goto(`/hire/candidates/${ready.candidate}?tab=interviews&decide=1`);
    await quiet(page);
    const notFound = await main(page).getByText(IW.notFound, { exact: true }).count();
    if (!notFound) await expect(page, 'sent away when Recruitment is off').toHaveURL('/hr');
    await expect(anyDecide(page)).toHaveCount(0);
    expect(await page.content()).not.toContain(ready.lastName);
  });
});

void chosenOf;
