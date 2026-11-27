import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { ON_DEV, avatarButton, type SignInPage } from './support/fixtures';
import type { CognitoFake } from './support/cognito-fake';
import type { ModulesFake } from './support/mod-02/modules-fake';
import { navLabels, openNav } from './support/mod-02/shell-snapshot';
import { WHO, companyIdIn, enter, iso, quiet, watchErrors, type HireFake, type Who } from './support/rec-ui/harness';
import { personHeader, readHeader, type RecordFake } from './support/rec-ui-02/record';
import type { EventsFake } from './support/rec-ui-02/notes';
import {
  IW, LIST, canOf, guest, inApp, interviewsDrawn, iv, person, readChosen, readRows, rowsOf, tab, voted, type InterviewsFake, type Iv,
} from './support/int-ui/interviews';
import {
  DAY_NAME, DEFAULT_TYPES, GOOD, GOOD_AT, GUEST_TOKEN, LENGTH_WORDS, PEOPLE_A, PEOPLE_B, SW, TIMES, allowedWords, anyDrawer, bookedHelp, bookedIv, cancelButton,
  choosePeople, closedButtonName, dateTimeErrors, dateTimeGroup, drawerOf, errorOf, expect, field, fieldBox, fillBooking, lengthWords, main, mainButton, openReschedule,
  openSchedule, panelMax, peopleOptions, pick, pickerDays, radio, rescheduleButton, scheduleButton, selectOptions, selected, summaryHeading, summaryOf,
  test, typeDate, w3, wordsIn, type Booking, type PanelSetting, type ScheduleFake, type SchedCall,
} from './support/int-ui/schedule';

/**
 * INT-UI-02 · Schedule and reschedule an interview: on a candidate's Interviews tab a Recruiter books an interview in a drawer (a full
 * page on a phone) and changes a booked one in the same drawer with the type locked; the server checks everything and sends the emails.
 * Jira NH-271 (epic NH-223, amber). Lock acceptance-lock/int-ui-02 (one squashed commit on acceptance-lock/int-ui-01.1, the child lock
 * that takes "Schedule an interview" and "Reschedule" out of INT-UI-01's ACTION_WORDS, M-1).
 * Spec: specs/interview-journey/cards/INT-UI-02.md, section "Changes after spec check round 1 (26 Nov)" (M-1 to M-3, S-1 to S-6, final
 * AC-1 to AC-11, decisions INT-UI-02-D1 to D20), its check INT-UI-02-spec-check.md (round 2 leftovers L-1 to L-8). The fakes answer as
 * the merged server does (support/int-ui/schedule.ts). Where the spec is silent, cards/int-ui-02.md says what these tests take (T-S1 up).
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg (08:00 UTC), a Thursday.
 * AC-11 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 */

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');
const desktopOnly = (why: string) => test.skip(test.info().project.name !== 'desktop-1280', `Desktop only: ${why}`);

type Fx = {
  page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null; record: RecordFake | null;
  events: EventsFake | null; interviews: InterviewsFake | null; sched: ScheduleFake | null;
};

const HOUR = 3_600_000;
const BONGANI = 'cand-bongani';
const TENDAI = 'cand-tendai';
const PULE = 'cand-w3';
const AYANDA = 'cand-ayanda';
const KAGISO = 'cand-kagiso';
const B_CAND = 'cand-b2';
const LINE = 'Bongani Mthembu · Fleet controller';
/** A time on a November 2026 day, given in Johannesburg hours. */
const sast = (day: number, hh: number, mm = 0) => iso(Date.UTC(2026, 10, day, hh - 2, mm));
const BAD_WORDS = /\b(null|undefined|NaN)\b|Invalid Date|\[object Object\]|⟦/;
/** The actions of cards not built yet. INT-UI-03 builds "Cancel interview", "Did not happen", "Mark as done" and More actions, so they
 *  left this check in child lock int-ui-02.1 (cards/int-ui-03.md); REC-UI-03 step 2 builds "Capture feedback", so it left in child
 *  lock int-ui-02.2 (cards/rec-ui-03.2.md). */
const OTHER_ACTIONS = ['Add panel member'];

async function asRecruiter(fx: Fx, who: Who = WHO.recruiterA): Promise<void> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
}
/** Opens a record at an address with a query, and waits for the header (or the not-found or failure line). */
async function openAt(page: Page, id: string, query = ''): Promise<void> {
  await page.goto(`/hire/candidates/${id}${query}`);
  await expect(personHeader(page).or(main(page).getByText(IW.notFound, { exact: true })).or(main(page).getByText('This candidate could not be loaded.', { exact: true })).first()).toBeVisible();
}
/** Signs in as A's Recruiter and opens Bongani's Interviews tab with these interviews. */
async function onTab(fx: Fx, list: Iv[], query = '?tab=interviews'): Promise<void> {
  fx.sched!.set(BONGANI, list, { done: 1, total: 3 });
  await asRecruiter(fx);
  await openAt(fx.page, BONGANI, query);
  await interviewsDrawn(fx.page);
}
/** Every control in `main` by what it says (text or label). */
async function controls(page: Page): Promise<string[]> {
  return main(page).evaluate((m) => [...m.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="link"]')]
    .map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`.replace(/\s+/g, ' ').trim()));
}
/** None of the controls of a card not built yet ("Add panel member"). */
async function noOtherActions(page: Page, where: string): Promise<void> {
  const found = (await controls(page)).filter((c) => OTHER_ACTIONS.some((w) => c.includes(w)));
  expect(found, `${where}: no action of a later card`).toEqual([]);
}
/** Clicks the n-th row and waits until it is the chosen one. */
async function chooseRow(page: Page, n: number): Promise<void> {
  await rowsOf(page).nth(n).click();
  await expect.poll(async () => (await readRows(page)).findIndex((r) => r.selected), { message: `row ${n} is chosen` }).toBe(n);
}
const chosenIndex = async (page: Page) => (await readRows(page)).findIndex((r) => r.selected);
const hasQuery = (page: Page, k: string) => new URL(page.url()).searchParams.has(k);
/** Presses the drawer's main button and waits for the page to settle. */
async function press(d: Locator, name: string = SW.schedule): Promise<void> {
  await mainButton(d, name).click();
  await quiet(d.page());
}
const lastWrite = (s: ScheduleFake): SchedCall => s.writes.at(-1)!;
/** The panel ids of a body, sorted (the order a multi-select keeps is checked where it is fixed by the test, T-S6). */
const sortedPanel = (b: unknown) => [...(((b as Record<string, unknown>)['panel'] as string[]) ?? [])].sort();

// The kit's interviews for Bongani (company A, Interview stage): one of each kind.
function bonganiList(): Iv[] {
  return [
    iv('iv-1', sast(3, 9, 30), 'COMPLETED', { type: 'PHONE_SCREEN', panel: [voted('Thandeka Dlamini', 'YES', 4)] }),
    iv('iv-2', sast(6, 14), 'CANCELLED', { type: 'BEHAVIORAL', closed_reason: 'CANDIDATE_ASKED', panel: [person('Sipho Ndlovu', 'WAITING', { person_id: 'sub-a-sipho' })] }),
    bookedIv('iv-3', sast(24, 10), { type: 'CULTURE_FIT' }),
  ];
}

// ================================================================ AC-1 Ways in
test.describe('AC-1 Ways in', () => {
  test.beforeEach(noBackendOnly);

  test('AC-1 "Schedule an interview" shows at the Interview stage once the tab\'s answer is drawn: under the list, and in the empty state under "No interviews yet."; not while loading, not on a failed read, not at Screening or Offer. "Reschedule" shows on the chosen booked interview exactly when its can.reschedule is true (a closed one with every flag true shows nothing, T-S13). No other action shows', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    const errors = watchErrors(page);
    sched!.set(BONGANI, [
      bookedIv('iv-r1', sast(24, 10)),
      bookedIv('iv-r2', sast(25, 10), { type: 'FINAL', can: canOf({ cancel: true, did_not_happen: true, mark_done: true, capture_feedback: true }) }),
      iv('iv-r3', sast(10, 10), 'COMPLETED', { type: 'PHONE_SCREEN', can: canOf('all'), panel: [voted('Sipho Ndlovu', 'YES', 4)] }),
    ]);
    await asRecruiter(fx);
    interviews!.refuse({ hold: true, id: BONGANI });
    await openAt(page, BONGANI, '?tab=interviews');
    await expect.poll(() => interviews!.heldCount).toBe(1);
    await page.waitForTimeout(300);
    await expect(scheduleButton(page), 'not while the tab loads').toHaveCount(0);
    interviews!.release();
    await interviewsDrawn(page);
    await expect(scheduleButton(page)).toHaveCount(1);
    await expect(scheduleButton(page)).toBeVisible();
    const listBox = (await main(page).locator(LIST).first().boundingBox())!;
    const buttonBox = (await scheduleButton(page).boundingBox())!;
    expect(buttonBox.y, 'the button sits under the list (kit place)').toBeGreaterThanOrEqual(listBox.y + listBox.height - 1);
    const rows = await readRows(page);
    for (const [i, want] of [[0, 1], [1, 0], [2, 0]] as const) {
      await chooseRow(page, i);
      await expect(rescheduleButton(page), `${rows[i]!.text}: Reschedule exactly when booked and can.reschedule is true`).toHaveCount(want);
      await noOtherActions(page, rows[i]!.text);
    }
    // The empty state.
    sched!.set(TENDAI, []);
    await openAt(page, TENDAI, '?tab=interviews');
    const empty = main(page).getByText(IW.empty, { exact: true });
    await expect(empty).toBeVisible();
    await expect(scheduleButton(page)).toBeVisible();
    expect((await scheduleButton(page).boundingBox())!.y, 'under "No interviews yet."').toBeGreaterThan((await empty.boundingBox())!.y);
    await noOtherActions(page, 'the empty state');
    // A failed read.
    interviews!.refuse({ status: 500, id: PULE });
    await openAt(page, PULE, '?tab=interviews');
    await expect(main(page).getByText(IW.failed, { exact: true })).toBeVisible();
    await quiet(page);
    await expect(scheduleButton(page), 'not on a failed read').toHaveCount(0);
    // Other stages: no Schedule button of either kind, also on a closed interview.
    for (const id of [AYANDA, KAGISO]) {
      sched!.set(id, [iv(`iv-${id}`, sast(12, 9), 'CANCELLED', { type: 'TECHNICAL', closed_reason: 'OTHER', can: canOf('all') })]);
      await openAt(page, id, '?tab=interviews');
      await interviewsDrawn(page);
      await quiet(page);
      await expect(main(page).getByRole('button', { name: new RegExp(`^${SW.schedule}`) }), `${id}: no Schedule button`).toHaveCount(0);
    }
    expect(errors, 'no console error').toEqual([]);
  });

  test('AC-1 A cancelled or did-not-happen interview carries a second button named "Schedule an interview, {type}" that opens the drawer with its type chosen; when that type is booked or done again, nothing is chosen; a booked or a done interview has no such button', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, [
      iv('iv-c1', sast(5, 9), 'CANCELLED', { type: 'TECHNICAL', closed_reason: 'CANDIDATE_ASKED' }),
      iv('iv-d1', sast(6, 9), 'DID_NOT_HAPPEN', { type: 'BEHAVIORAL', closed_reason: 'OTHER' }),
      iv('iv-c2', sast(7, 9), 'CANCELLED', { type: 'FINAL', closed_reason: 'OTHER' }),
      bookedIv('iv-f', sast(26, 9), { type: 'FINAL' }),
      iv('iv-p', sast(4, 9), 'COMPLETED', { type: 'PHONE_SCREEN', panel: [voted('Thandeka Dlamini', 'YES', 4)] }),
    ]);
    for (const [row, key, want] of [[0, 'TECHNICAL', 'Technical'], [1, 'BEHAVIORAL', 'Behavioral'], [2, 'FINAL', '']] as const) {
      await chooseRow(page, row);
      const second = main(page).getByRole('button', { name: closedButtonName(key), exact: true });
      await expect(second).toHaveCount(1);
      const d = await openSchedule(page, second);
      expect(await selected(d, SW.type), `${key}: ${want || 'nothing'} chosen`).toBe(want);
      await cancelButton(d).click();
      await expect(d).toBeHidden();
      await expect(second, 'focus returns to the button that opened the drawer').toBeFocused();
    }
    await chooseRow(page, 3);
    await expect(main(page).getByRole('button', { name: new RegExp(`^${SW.schedule}, `) }), 'a booked interview: no second button').toHaveCount(0);
    await chooseRow(page, 4);
    await expect(main(page).getByRole('button', { name: new RegExp(`^${SW.schedule}, `) }), 'a done interview: no second button (rule 2b)').toHaveCount(0);
  });

  test('AC-1 ?tab=interviews&schedule=new opens the drawer and survives a reload; Cancel, the close button, Escape and a save each take `schedule` out of the address with no new history entry; at Screening, on a failed read and with any other value nothing opens and `schedule` is removed', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, bonganiList(), '?tab=interviews&schedule=new');
    let d = drawerOf(page);
    await expect(d).toBeVisible();
    await page.reload();
    await expect(d, 'the address way survives a reload').toBeVisible();
    await expect(field(d, SW.type)).toBeVisible();
    const entries = await page.evaluate(() => history.length);
    const closers: Array<[string, (x: Locator) => Promise<void>]> = [
      ['Cancel', (x) => cancelButton(x).click()],
      ['the close button', (x) => x.getByRole('button', { name: SW.close, exact: true }).click()],
      ['Escape', () => page.keyboard.press('Escape')],
    ];
    for (const [i, [how, close]] of closers.entries()) {
      if (i > 0) { await openAt(page, BONGANI, '?tab=interviews&schedule=new'); await expect(d).toBeVisible(); }
      await close(d);
      await expect(d, how).toBeHidden();
      expect(hasQuery(page, 'schedule'), `${how} takes schedule out`).toBe(false);
      expect(new URL(page.url()).searchParams.get('tab'), how).toBe('interviews');
    }
    expect(await page.evaluate(() => history.length) - entries, 'no history entry beyond the opened addresses').toBeLessThanOrEqual(2);
    // Saving.
    await openAt(page, BONGANI, '?tab=interviews&schedule=new');
    d = drawerOf(page);
    await expect(field(d, SW.type)).toBeVisible();
    const before = await page.evaluate(() => history.length);
    await fillBooking(d, GOOD);
    await press(d);
    await expect(d).toBeHidden();
    expect(hasQuery(page, 'schedule'), 'a save takes schedule out').toBe(false);
    expect(await page.evaluate(() => history.length), 'replaceState: no new history entry').toBe(before);
    // Ignored and removed.
    sched!.set(AYANDA, []);
    interviews!.refuse({ status: 500, id: PULE });
    for (const [id, q] of [[AYANDA, '?tab=interviews&schedule=new'], [PULE, '?tab=interviews&schedule=new'], [BONGANI, '?tab=interviews&schedule=TECHNICAL'], [BONGANI, '?tab=interviews&schedule=1']] as const) {
      const reads = sched!.of('people').length;
      await openAt(page, id, q);
      await expect(main(page).getByText(IW.failed, { exact: true }).or(rowsOf(page).first()).or(main(page).getByText(IW.empty, { exact: true })).first()).toBeVisible();
      await quiet(page);
      await expect(anyDrawer(page), `${id}${q}: nothing opens`).toHaveCount(0);
      await expect.poll(() => hasQuery(page, 'schedule'), { message: `${id}${q}: schedule is removed` }).toBe(false);
      expect(sched!.of('people').length, `${id}${q}: no drawer read`).toBe(reads);
    }
  });
});


test.describe('AC-1 Closing drops what was typed', () => {
  test.beforeEach(noBackendOnly);

  test('AC-1 Cancel, the close button and Escape drop everything typed: opened again, nothing is chosen or filled', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    sched!.panelConfig.A = { interview_emails: 'ON' };
    await onTab(fx, []);
    const closers: Array<[string, (x: Locator) => Promise<void>]> = [
      ['Cancel', (x) => cancelButton(x).click()],
      ['the close button', (x) => x.getByRole('button', { name: SW.close, exact: true }).click()],
      ['Escape', () => page.keyboard.press('Escape')],
    ];
    for (const [how, close] of closers) {
      let d = await openSchedule(page);
      await fillBooking(d, { ...GOOD, guest: 'naledi@fleetwise.co.za', note: 'Bring your ID book.' });
      await close(d);
      await expect(d, how).toBeHidden();
      d = await openSchedule(page);
      expect(await selected(d, SW.type), how).toBe('');
      await expect(field(d, SW.date), how).toHaveValue('');
      expect(await selected(d, SW.time), how).toBe('');
      expect(await selected(d, SW.length), how).toBe('');
      for (const r of [SW.inPerson, SW.online]) await expect(radio(d, r), how).not.toBeChecked();
      await expect(field(d, SW.place), how).toHaveCount(0);
      expect((await peopleOptions(d)).filter((x) => x.chosen), how).toEqual([]);
      await expect(field(d, SW.guest), how).toHaveValue('');
      await expect(field(d, SW.note), how).toHaveValue('');
      await cancelButton(d).click();
      await expect(d).toBeHidden();
    }
  });
});

// ================================================================ AC-2 Fields and choices
test.describe('AC-2 Fields and choices', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2 The drawer: title, "{candidate} · {role}", the fields in rule 4\'s order with their labels and W-1; type options in settings order in interview words, booked or done ones disabled and named by W-9a; 96 times "00:00" to "23:45"; the 16 W-17 lengths; the people in answer order; nothing chosen; no guest field, W-2 or W-3 while emails are off', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    sched!.types.A = [
      { key: 'FINAL', label: 'Final round', optional: false }, { key: 'PHONE_SCREEN', label: 'Phone Screen', optional: false },
      { key: 'CULTURE_FIT', label: 'Culture Fit', optional: false }, { key: 'PANEL_REVIEW', label: 'Panel Review Session', optional: true }, { key: 'TECHNICAL', label: 'Technical', optional: false },
    ];
    await onTab(fx, [
      iv('iv-1', sast(3, 9), 'COMPLETED', { type: 'PHONE_SCREEN', panel: [voted('Sipho Ndlovu', 'YES', 4)] }),
      iv('iv-2', sast(5, 9), 'CANCELLED', { type: 'TECHNICAL', closed_reason: 'OTHER' }),
      iv('iv-3', sast(6, 9), 'DID_NOT_HAPPEN', { type: 'FINAL', closed_reason: 'OTHER' }),
      bookedIv('iv-4', sast(24, 10), { type: 'CULTURE_FIT' }),
    ]);
    const d = await openSchedule(page);
    await expect(d.locator('.pp-drawer__title')).toHaveText(SW.schedule);
    await expect(d.locator('.pp-drawer__description')).toHaveText(LINE);
    const labels = await d.evaluate((el) => [...el.querySelectorAll('.pp-field__label, legend')].map((l) => (l.textContent ?? '').replace('(optional)', '').replace('*', '').replace(/\s+/g, ' ').trim()).filter((t, i, a) => t && a.indexOf(t) === i));
    expect(labels, 'the fields in rule 4\'s order (Place and Video link wait for Where; no guest while emails are off)').toEqual([SW.type, SW.dateTime, SW.date, SW.time, SW.length, SW.where, SW.panel, SW.note]);
    await expect(dateTimeGroup(d).getByLabel(SW.date, { exact: true })).toHaveCount(1);
    await expect(dateTimeGroup(d).getByLabel(SW.time, { exact: true })).toHaveCount(1);
    await expect(d.getByText(SW.sast, { exact: true })).toBeVisible();
    await expect(d.getByRole('group', { name: SW.where, exact: true }).getByRole('radio')).toHaveCount(2);
    await expect(fieldBox(d, SW.note).locator('.pp-field__optional')).toHaveText(SW.optional);
    expect(await selectOptions(d, SW.type)).toEqual([
      { text: 'Final', disabled: false }, { text: 'Phone screen', disabled: true }, { text: 'Culture fit', disabled: true }, { text: 'Panel review', disabled: false }, { text: 'Technical', disabled: false },
    ]);
    await expect(d.getByText(bookedHelp(['Phone screen', 'Culture fit']), { exact: true }), 'W-9a in settings order').toBeVisible();
    expect((await selectOptions(d, SW.time)).map((o) => o.text), 'the 96 times').toEqual(TIMES);
    expect((await selectOptions(d, SW.length)).map((o) => o.text), 'the 16 lengths, W-17').toEqual(LENGTH_WORDS);
    for (const l of [SW.type, SW.time, SW.length]) expect(await selected(d, l), `${l}: nothing chosen`).toBe('');
    await expect(field(d, SW.date)).toHaveValue('');
    for (const r of [SW.inPerson, SW.online]) await expect(radio(d, r)).not.toBeChecked();
    await expect(field(d, SW.place)).toHaveCount(0);
    await expect(field(d, SW.link)).toHaveCount(0);
    expect(await peopleOptions(d), 'the people read, in answer order, none chosen').toEqual(PEOPLE_A.map((x) => ({ name: x.name, chosen: false })));
    await expect(field(d, SW.guest)).toHaveCount(0);
    await expect(d.getByText(SW.guestHelp, { exact: true })).toHaveCount(0);
    await expect(d.getByText(/each get an email with a calendar invite/)).toHaveCount(0);
    await expect(mainButton(d)).toBeVisible();
    await expect(cancelButton(d)).toBeVisible();
    expect(await d.innerText()).not.toMatch(BAD_WORDS);
  });

  test('AC-2 With empty settings the five default types show in the default order; a type\'s default length fills Length until a length is chosen by hand; Place and Video link swap with Where and each keeps its own typing', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, []);
    let d = await openSchedule(page);
    expect(await selectOptions(d, SW.type), 'the five defaults (D3), in interview words (D4)').toEqual(['Phone screen', 'Technical', 'Behavioral', 'Culture fit', 'Final'].map((text) => ({ text, disabled: false })));
    await expect(d.getByText(/already booked or done/)).toHaveCount(0);
    await cancelButton(d).click();
    sched!.types.A = [{ ...DEFAULT_TYPES[1]!, default_length_minutes: 90 }, { ...DEFAULT_TYPES[4]!, default_length_minutes: 45 }, DEFAULT_TYPES[0]!];
    d = await openSchedule(page);
    await pick(d, SW.type, 'Technical');
    await expect.poll(() => selected(d, SW.length)).toBe('1 hour 30 minutes');
    await pick(d, SW.type, 'Final');
    await expect.poll(() => selected(d, SW.length), 'still not chosen by hand: the new default').toBe('45 minutes');
    await pick(d, SW.length, '2 hours');
    await pick(d, SW.type, 'Technical');
    await page.waitForTimeout(200);
    expect(await selected(d, SW.length), 'a length chosen by hand stays').toBe('2 hours');
    await radio(d, SW.inPerson).check();
    await expect(field(d, SW.place)).toBeVisible();
    await expect(field(d, SW.link)).toHaveCount(0);
    await field(d, SW.place).fill('Boardroom 4');
    await radio(d, SW.online).check();
    await expect(field(d, SW.link)).toBeVisible();
    await expect(field(d, SW.place)).toHaveCount(0);
    await field(d, SW.link).fill('https://meet.example.test/bongani');
    await radio(d, SW.inPerson).check();
    await expect(field(d, SW.place)).toHaveValue('Boardroom 4');
    await radio(d, SW.online).check();
    await expect(field(d, SW.link)).toHaveValue('https://meet.example.test/bongani');
  });

  test('AC-2 The guest field and W-2 show only with PANEL_CONFIG.interview_emails \'ON\' and guestAllowed not false; W-3 shows only when interview_emails and candidate_interview_emails are both \'ON\', with "the guest" only while a guest address is typed', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, []);
    const cases: Array<[Parameters<typeof Object.assign>[1], boolean, boolean]> = [
      [{ interview_emails: 'ON' }, true, false],
      [{ interview_emails: 'ON', guestAllowed: true }, true, false],
      [{ interview_emails: 'ON', guestAllowed: false }, false, false],
      [{ guestAllowed: true }, false, false],
      [{ interview_emails: 'OFF', candidate_interview_emails: 'ON' }, false, false],
      [{ interview_emails: 'ON', candidate_interview_emails: 'ON' }, true, true],
      [{ interview_emails: 'ON', candidate_interview_emails: 'ON', guestAllowed: false }, false, true],
    ];
    for (const [config, guestShown, lineShown] of cases) {
      sched!.panelConfig.A = config as never;
      const d = await openSchedule(page);
      const what = JSON.stringify(config);
      await expect(field(d, SW.guest), `${what}: guest field`).toHaveCount(guestShown ? 1 : 0);
      await expect(d.getByText(SW.guestHelp, { exact: true }), `${what}: W-2`).toHaveCount(guestShown ? 1 : 0);
      if (guestShown) await expect(fieldBox(d, SW.guest).locator('.pp-field__optional')).toHaveText(SW.optional);
      await expect(d.getByText(w3('Bongani', false), { exact: true }), `${what}: W-3`).toHaveCount(lineShown ? 1 : 0);
      if (lineShown && guestShown) {
        await field(d, SW.guest).fill('naledi@fleetwise.co.za');
        await expect(d.getByText(w3('Bongani', true), { exact: true })).toBeVisible();
        await field(d, SW.guest).fill('');
        await expect(d.getByText(w3('Bongani', false), { exact: true })).toBeVisible();
      }
      await cancelButton(d).click();
      await expect(d).toBeHidden();
    }
  });
});

// ================================================================ AC-3 Checks
test.describe('AC-3 Checks', () => {
  test.beforeEach(noBackendOnly);

  test('AC-3 Pressing with nothing filled: each check\'s message under its field and in the summary "Fix 6 things to continue", which takes focus and whose links move focus to the field; no booking is sent; fixing a field clears its message', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, []);
    const d = await openSchedule(page);
    await press(d);
    expect(sched!.writes, 'no booking is sent').toHaveLength(0);
    expect(await errorOf(fieldBox(d, SW.type))).toBe(SW.typeEmpty);
    expect(await dateTimeErrors(d)).toEqual(expect.arrayContaining([SW.dateEmpty, SW.timeEmpty]));
    expect(await errorOf(fieldBox(d, SW.length))).toBe(SW.lengthEmpty);
    await expect(d.getByRole('group', { name: SW.where, exact: true }).locator('.pp-field__error')).toHaveText(SW.whereEmpty);
    await expect(fieldBox(d, SW.panel).locator('.pp-field__error')).toHaveText(SW.panelEmpty);
    const s = await summaryOf(d);
    expect(s, 'one error summary').not.toBeNull();
    expect(s!.lines).toEqual([`${SW.type}: ${SW.typeEmpty}`, `${SW.dateTime}: ${SW.dateEmpty}`, `${SW.dateTime}: ${SW.timeEmpty}`, `${SW.length}: ${SW.lengthEmpty}`, `${SW.where}: ${SW.whereEmpty}`, `${SW.panel}: ${SW.panelEmpty}`]);
    expect(s!.heading).toBe(summaryHeading(6));
    await expect(d.locator('.pp-form-error-summary'), 'the summary takes focus').toBeFocused();
    await d.locator('.pp-form-error-summary').getByRole('link', { name: `${SW.type}: ${SW.typeEmpty}` }).click();
    await expect(field(d, SW.type)).toBeFocused();
    await d.locator('.pp-form-error-summary').getByRole('link', { name: `${SW.length}: ${SW.lengthEmpty}` }).click();
    await expect(field(d, SW.length)).toBeFocused();
    await pick(d, SW.type, 'Technical');
    await expect.poll(() => errorOf(fieldBox(d, SW.type)), 'fixing the type clears its message').toBe('');
    expect(await errorOf(fieldBox(d, SW.length)), 'the others stay').toBe(SW.lengthEmpty);
    await pick(d, SW.length, '1 hour');
    await expect.poll(() => errorOf(fieldBox(d, SW.length))).toBe('');
    await radio(d, SW.online).check();
    await expect(d.getByRole('group', { name: SW.where, exact: true }).locator('.pp-field__error')).toHaveCount(0);
    expect(sched!.writes).toHaveLength(0);
  });

  test('AC-3 An empty place, a link that is not https:// (or holds a space, or is not a web address), too many people ("Choose up to 1 person", "Choose up to 2 people"), a guest address that is not an email and a time not after now each refuse with their own message; nothing is sent', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    sched!.panelConfig.A = { interview_emails: 'ON' };
    hire!.world.options.A.panel_size_by_level['JUNIOR'] = 1;
    record!.set(BONGANI, { level: 'JUNIOR' });
    await onTab(fx, []);
    let d = await openSchedule(page);
    await fillBooking(d, { ...GOOD, place: '   ' });
    await press(d);
    expect(await errorOf(fieldBox(d, SW.place))).toBe(SW.placeEmpty);
    expect((await summaryOf(d))!.lines).toEqual([`${SW.place}: ${SW.placeEmpty}`]);
    await radio(d, SW.online).check();
    for (const link of ['', 'http://meet.example.test/x', 'https://meet.example .test/x', 'https://', 'www.meet.example.test']) {
      await field(d, SW.link).fill(link);
      await press(d);
      expect(await errorOf(fieldBox(d, SW.link)), `"${link}"`).toBe(SW.badLink);
    }
    await field(d, SW.link).fill('https://meet.example.test/bongani');
    await choosePeople(d, ['Lerato Mokoena']);
    await press(d);
    expect(await errorOf(fieldBox(d, SW.panel)), 'JUNIOR panel size 1').toBe(panelMax(1));
    await choosePeople(d, ['Lerato Mokoena']);
    await field(d, SW.guest).fill('naledi@');
    await press(d);
    expect(await errorOf(fieldBox(d, SW.guest))).toBe(SW.emailWrong);
    await field(d, SW.guest).fill('');
    for (const [day, time] of [['19 Nov 2026', '09:45'], ['19 Nov 2026', '10:00']] as const) {
      await typeDate(d, day);
      await pick(d, SW.time, time);
      await press(d);
      expect(await dateTimeErrors(d), `${day} ${time} is not after now`).toEqual([SW.future]);
      expect((await summaryOf(d))!.lines).toEqual([`${SW.dateTime}: ${SW.future}`]);
    }
    expect(sched!.writes, 'nothing is sent').toHaveLength(0);
    // Panel size 2 for the same level, read again with the record.
    hire!.world.options.A.panel_size_by_level['JUNIOR'] = 2;
    await page.reload();
    await interviewsDrawn(page);
    d = await openSchedule(page);
    await fillBooking(d, { ...GOOD, people: ['Sipho Ndlovu', 'Lerato Mokoena', 'Thabo Khumalo'] });
    await press(d);
    expect(await errorOf(fieldBox(d, SW.panel))).toBe(panelMax(2));
    expect(sched!.writes).toHaveLength(0);
  });

  test('AC-3 The date picker\'s own messages: "31 Nov 2026" shows "November has 30 days. …" and "tomorrowish" shows "Enter the date like this: 23 Nov 2026." under the field and in the summary as "Date and time: …"; picking a day from the calendar clears it (L-2); a day before today shows "Choose a date the calendar allows."; nothing is sent', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, []);
    const d = await openSchedule(page);
    const { date: _date, ...rest } = GOOD;
    await fillBooking(d, rest);
    for (const [typed, message] of [['31 Nov 2026', pickerDays('November', 30, 2026)], ['tomorrowish', SW.pickerFormat], ['18 Nov 2026', SW.pickerNotAllowed]] as const) {
      await typeDate(d, typed);
      await press(d);
      expect(await dateTimeErrors(d), typed).toEqual([message]);
      expect((await summaryOf(d))!.lines, typed).toEqual([`${SW.dateTime}: ${message}`]);
      if (typed === 'tomorrowish') {
        await d.getByRole('button', { name: SW.pickerButton, exact: true }).click();
        await d.page().getByRole('button', { name: /^Tuesday 24 November 2026/ }).click();
        await expect(field(d, SW.date)).toHaveValue('24 Nov 2026');
        await expect.poll(() => dateTimeErrors(d), 'picking a day clears the picker\'s message').toEqual([]);
      }
    }
    expect(sched!.writes).toHaveLength(0);
  });
});

// ================================================================ AC-4 Request
test.describe('AC-4 Request', () => {
  test.beforeEach(noBackendOnly);

  test('AC-4 A valid booking sends exactly one POST with exactly the rule 6 body (trimmed, the people in the order chosen, guest and note only when filled, never both place and link) and one Idempotency-Key; a double click sends one; no request carries a company; the settings reads ask for INTERVIEW_TYPES and PANEL_CONFIG with active=true; the people read has no query', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    sched!.panelConfig.A = { interview_emails: 'ON' };
    await onTab(fx, []);
    let d = await openSchedule(page);
    await fillBooking(d, { ...GOOD, place: '  Durban depot, 14 Quay Road  ', people: ['Lerato Mokoena', 'Sipho Ndlovu'], guest: '  naledi@fleetwise.co.za ', note: '  Bring your ID book.  ' });
    await mainButton(d).dblclick();
    await expect(d).toBeHidden();
    await quiet(page);
    expect(sched!.writes, 'a double click sends one request').toHaveLength(1);
    const call = lastWrite(sched!);
    expect(call.method).toBe('POST');
    expect(call.path).toBe(`/v1/candidates/${BONGANI}/interviews`);
    expect(call.body).toEqual({
      type: 'TECHNICAL', at: GOOD_AT, length_minutes: 60, where: 'IN_PERSON', place: 'Durban depot, 14 Quay Road', panel: ['sub-a-lerato', 'sub-a-sipho'],
      guest_email: 'naledi@fleetwise.co.za', candidate_note: 'Bring your ID book.',
    });
    expect(Object.keys(call.body as object), 'the keys in rule 6\'s order').toEqual(['type', 'at', 'length_minutes', 'where', 'place', 'panel', 'guest_email', 'candidate_note']);
    expect(call.idempotencyKey ?? '').toMatch(/^.{1,200}$/);
    expect(call.status).toBe(201);
    expect(sched!.of('types').map((c) => c.query)).toEqual([{ configType: 'INTERVIEW_TYPES', active: 'true' }]);
    expect(sched!.of('panelConfig').map((c) => c.query)).toEqual([{ configType: 'PANEL_CONFIG', active: 'true' }]);
    expect(sched!.of('people').map((c) => c.query), 'the people read never asks for candidateId (guest links)').toEqual([{}]);
    // A second booking, online, nothing optional: no place, no guest, no note, the link trimmed.
    d = await openSchedule(page);
    await fillBooking(d, { type: 'Final', date: '25 Nov 2026', time: '14:15', length: '45 minutes', where: 'Online', link: '  https://meet.example.test/final-round  ', people: ['Thabo Khumalo'] });
    await field(d, SW.guest).fill('   ');
    await press(d);
    await expect(d).toBeHidden();
    expect(lastWrite(sched!).body).toEqual({ type: 'FINAL', at: '2026-11-25T14:15:00+02:00', length_minutes: 45, where: 'ONLINE', video_link: 'https://meet.example.test/final-round', panel: ['sub-a-thabo'] });
    for (const c of sched!.requests) {
      expect(companyIdIn(c), `${c.method} ${c.path}`).toEqual([]);
      expect(c.query['candidateId'], `${c.path}: no candidateId`).toBeUndefined();
    }
    expect(await page.content(), 'no guest link token anywhere').not.toContain(GUEST_TOKEN);
  });

  for (const zone of ['UTC', 'Pacific/Kiritimati', 'America/Sao_Paulo']) {
    test.describe(`with the browser in ${zone}`, () => {
      test.use({ timezoneId: zone });

      test(`AC-4 With the browser in ${zone}, 24 Nov 2026 at 10:00 is sent as "2026-11-24T10:00:00+02:00" (D7)`, async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
        const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
        await onTab(fx, []);
        const d = await openSchedule(page);
        await fillBooking(d, GOOD);
        await press(d);
        await expect(d).toBeHidden();
        expect((lastWrite(sched!).body as Record<string, unknown>)['at']).toBe(GOOD_AT);
      });
    });
  }

  test.describe('with the browser in UTC at 22:30 on 30 Nov (00:30 on 1 Dec in Johannesburg)', () => {
    test.use({ timezoneId: 'UTC' });

    test('AC-4 With the browser in UTC at 22:30 on 30 Nov, the earliest day the picker allows is 1 Dec (30 Nov is off, typed it is "Choose a date the calendar allows."), and 3 Dec at 10:00 is sent as "2026-12-03T10:00:00+02:00" (S-3)', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
      const late = Date.UTC(2026, 10, 30, 22, 30);
      await page.clock.setFixedTime(late);
      hire!.world.now = late;
      sched!.now = late;
      await onTab(fx, []);
      const d = await openSchedule(page);
      await d.getByRole('button', { name: SW.pickerButton, exact: true }).click();
      await expect(page.getByRole('button', { name: /^Monday 30 November 2026/ })).toBeDisabled();
      await expect(page.getByRole('button', { name: /^Tuesday 1 December 2026/ })).toBeEnabled();
      await page.getByRole('button', { name: /^Thursday 3 December 2026/ }).click();
      await expect(field(d, SW.date)).toHaveValue('3 Dec 2026');
      await fillBooking(d, { type: 'Technical', time: '10:00', length: '1 hour', where: 'Online', link: 'https://meet.example.test/x', people: ['Sipho Ndlovu'] });
      await typeDate(d, '30 Nov 2026');
      await press(d);
      expect(await dateTimeErrors(d)).toEqual([SW.pickerNotAllowed]);
      await typeDate(d, '3 Dec 2026');
      await press(d);
      await expect(d).toBeHidden();
      expect((lastWrite(sched!).body as Record<string, unknown>)['at']).toBe('2026-12-03T10:00:00+02:00');
    });
  });

  test('AC-4 The request key: one new key per opening; a retry after a failed save with nothing changed reuses it; a retry after a change uses a new one', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, []);
    let d = await openSchedule(page);
    await fillBooking(d, GOOD);
    sched!.refuse({ kind: 'book', status: 500 });
    sched!.refuse({ kind: 'book', status: 500 });
    await press(d);
    await expect(d.getByText(SW.saveFail, { exact: true })).toBeVisible();
    await press(d);
    const [k1, k2] = sched!.writes.map((c) => c.idempotencyKey);
    expect(k1).toBeTruthy();
    expect(k2, 'an unchanged retry reuses the key').toBe(k1);
    await field(d, SW.note).fill('Bring your ID book.');
    await press(d);
    await expect(d).toBeHidden();
    const k3 = lastWrite(sched!).idempotencyKey;
    expect(k3, 'a changed body gets a new key').not.toBe(k1);
    d = await openSchedule(page);
    await fillBooking(d, { ...GOOD, type: 'Final' });
    await press(d);
    await expect(d).toBeHidden();
    const k4 = lastWrite(sched!).idempotencyKey;
    expect(new Set([k1, k3, k4]).size, 'each opening has its own key').toBe(3);
  });
});

// ================================================================ AC-5 Answers
test.describe('AC-5 Answers', () => {
  test.beforeEach(noBackendOnly);

  test('AC-5 After 201 the drawer closes, the tab reads the interviews once more, and the new interview is chosen and named in the address; no toast', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, bonganiList());
    const reads = interviews!.reads(BONGANI).length;
    const d = await openSchedule(page);
    await fillBooking(d, GOOD);
    await press(d);
    await expect(d).toBeHidden();
    expect(interviews!.reads(BONGANI).length - reads, 'one read more').toBe(1);
    await expect(page).toHaveURL(/[?&]interview=iv-booked-1(&|$)/);
    await expect.poll(async () => (await readRows(page)).length).toBe(4);
    expect((await readChosen(page)).title).toBe('Technical');
    expect((await readRows(page))[await chosenIndex(page)]!.text).toContain('24 Nov 2026');
    await expect(page.locator('.pp-flag, .pp-toast, [role="status"]').filter({ hasText: /\S/ }), 'no toast').toHaveCount(0);
  });

  test('AC-5 AT_IN_PAST and each INVALID_FIELD field (video_link on an online booking) show that field\'s message under it and in the summary, which takes focus; the drawer stays with everything kept; INVALID_FIELD panel reads the people once more', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    sched!.panelConfig.A = { interview_emails: 'ON' };
    await onTab(fx, []);
    const d = await openSchedule(page);
    await fillBooking(d, { ...GOOD, guest: 'naledi@fleetwise.co.za' });
    const rows: Array<[string, string, string, () => Promise<string[]>]> = [
      ['AT_IN_PAST', 'at', SW.future, () => dateTimeErrors(d)],
      ['INVALID_FIELD', 'type', SW.typeEmpty, async () => [await errorOf(fieldBox(d, SW.type))]],
      ['INVALID_FIELD', 'at', SW.future, () => dateTimeErrors(d)],
      ['INVALID_FIELD', 'length_minutes', SW.lengthEmpty, async () => [await errorOf(fieldBox(d, SW.length))]],
      ['INVALID_FIELD', 'where', SW.whereEmpty, async () => [((await d.getByRole('group', { name: SW.where, exact: true }).locator('.pp-field__error').allInnerTexts())[0] ?? '').trim()]],
      ['INVALID_FIELD', 'place', SW.placeEmpty, async () => [await errorOf(fieldBox(d, SW.place))]],
      ['INVALID_FIELD', 'panel', SW.panelEmpty, async () => [await errorOf(fieldBox(d, SW.panel))]],
      ['INVALID_FIELD', 'guest_email', SW.emailWrong, async () => [await errorOf(fieldBox(d, SW.guest))]],
    ];
    const label: Record<string, string> = { at: SW.dateTime, type: SW.type, length_minutes: SW.length, where: SW.where, place: SW.place, panel: SW.panel, guest_email: SW.guest };
    for (const [code, f, message, read] of rows) {
      const people = sched!.of('people').length;
      sched!.refuse({ kind: 'book', status: 400, body: { error: 'Bad request', code, field: f } });
      await press(d);
      await expect(d, `${code} ${f}: the drawer stays`).toBeVisible();
      expect(await read(), `${code} ${f}`).toEqual([message]);
      expect((await summaryOf(d))?.lines, `${code} ${f}: summary`).toEqual([`${label[f]}: ${message}`]);
      await expect(d.locator('.pp-form-error-summary')).toBeFocused();
      expect(await selected(d, SW.type), 'kept').toBe('Technical');
      await expect(field(d, SW.date)).toHaveValue('24 Nov 2026');
      expect(await selected(d, SW.time)).toBe('10:00');
      await expect(field(d, SW.place)).toHaveValue(GOOD.place);
      await expect(field(d, SW.guest)).toHaveValue('naledi@fleetwise.co.za');
      expect(sched!.of('people').length - people, `${f}: people read again only for panel`).toBe(f === 'panel' ? 1 : 0);
    }
    // INVALID_FIELD video_link needs an online booking (lock check M-2): W-10b under Video link and in the summary, everything kept.
    await radio(d, SW.online).check();
    await field(d, SW.link).fill('https://meet.example.test/bongani');
    sched!.refuse({ kind: 'book', status: 400, body: { error: 'Bad request', code: 'INVALID_FIELD', field: 'video_link' } });
    await press(d);
    await expect(d, 'video_link: the drawer stays').toBeVisible();
    expect(await errorOf(fieldBox(d, SW.link)), 'video_link').toBe(SW.badLink);
    expect((await summaryOf(d))?.lines, 'video_link: summary').toEqual([`${SW.link}: ${SW.badLink}`]);
    await expect(d.locator('.pp-form-error-summary')).toBeFocused();
    await expect(field(d, SW.link)).toHaveValue('https://meet.example.test/bongani');
    expect(await selected(d, SW.type), 'kept').toBe('Technical');
    await expect(field(d, SW.guest)).toHaveValue('naledi@fleetwise.co.za');
    await expect(d.getByText(SW.saveFail, { exact: true }), 'video_link: not the save-failure line').toHaveCount(0);
  });

  test('AC-5 TYPE_ALREADY_BOOKED (the type was booked meanwhile) shows W-9a\'s server line on the type; the tab reads the interviews again, which disables that type, and the type choice is cleared', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, bonganiList());
    const d = await openSchedule(page);
    await fillBooking(d, GOOD);
    sched!.listOf(BONGANI).push(bookedIv('iv-meanwhile', sast(27, 9), { type: 'TECHNICAL' }));
    const reads = interviews!.reads(BONGANI).length;
    await press(d);
    expect(lastWrite(sched!).status).toBe(409);
    await expect(d).toBeVisible();
    expect(await errorOf(fieldBox(d, SW.type))).toBe(SW.bookedServer);
    expect(interviews!.reads(BONGANI).length - reads, 'the tab reads again').toBe(1);
    await expect.poll(async () => (await selectOptions(d, SW.type)).find((o) => o.text === 'Technical')?.disabled).toBe(true);
    expect(await selected(d, SW.type), 'the type choice is cleared').toBe('');
    await expect(field(d, SW.date), 'the rest is kept').toHaveValue('24 Nov 2026');
  });

  test('AC-5 GUEST_EMAIL_OFF (the switch went off meanwhile) reads the settings again, the guest field goes with its value, and the save-failure line shows; the next press books without a guest', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    sched!.panelConfig.A = { interview_emails: 'ON' };
    await onTab(fx, []);
    const d = await openSchedule(page);
    await fillBooking(d, { ...GOOD, guest: 'naledi@fleetwise.co.za' });
    sched!.panelConfig.A = { interview_emails: 'OFF' };
    await press(d);
    expect((lastWrite(sched!).body as Record<string, unknown>)['guest_email']).toBe('naledi@fleetwise.co.za');
    expect(lastWrite(sched!).status).toBe(409);
    await expect(d.getByText(SW.saveFail, { exact: true })).toBeVisible();
    expect(sched!.of('panelConfig'), 'settings read again').toHaveLength(2);
    await expect(field(d, SW.guest)).toHaveCount(0);
    expect(await d.innerText()).not.toContain('naledi@fleetwise.co.za');
    await press(d);
    await expect(d).toBeHidden();
    expect(lastWrite(sched!).body).not.toHaveProperty('guest_email');
  });

  test('AC-5 NOT_ALLOWED_NOW (the candidate moved on meanwhile) shows the save-failure line and reads the record and the tab again; once closed, the Schedule button is gone', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, bonganiList());
    const d = await openSchedule(page);
    await fillBooking(d, GOOD);
    hire!.world.cands.find((c) => c.id === BONGANI)!.stage = 'OFFER';
    const recs = record!.reads(BONGANI).length, reads = interviews!.reads(BONGANI).length;
    await press(d);
    expect(lastWrite(sched!).status).toBe(409);
    await expect(d.getByText(SW.saveFail, { exact: true })).toBeVisible();
    expect(record!.reads(BONGANI).length - recs, 'the record is read again').toBe(1);
    expect(interviews!.reads(BONGANI).length - reads, 'the tab is read again').toBe(1);
    await cancelButton(d).click();
    await expect(d).toBeHidden();
    await quiet(page);
    await expect(main(page).getByRole('button', { name: new RegExp(`^${SW.schedule}`) })).toHaveCount(0);
  });

  test('AC-5 Every other answer (400 with another field, 403, 404, 409 KEY_IN_USE, 409 KEY_REUSED, 500) shows "Your change could not be saved. Try again." at the top with every typed value kept', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, []);
    const d = await openSchedule(page);
    await fillBooking(d, { ...GOOD, note: 'Bring your ID book.' });
    const answers: Array<[number, unknown]> = [
      [400, { error: 'Bad request', code: 'INVALID_FIELD', field: 'candidate_note' }], [403, { error: 'Forbidden' }], [404, { error: 'Not found' }],
      [409, { error: 'Conflict', code: 'KEY_IN_USE' }], [409, { error: 'Conflict', code: 'KEY_REUSED' }], [500, { error: 'Internal error' }],
    ];
    for (const [status, body] of answers) {
      sched!.refuse({ kind: 'book', status, body });
      await press(d);
      const what = `${status} ${JSON.stringify(body)}`;
      await expect(d.locator('.pp-section-message--danger').filter({ hasText: SW.saveFail }), what).toBeVisible();
      expect(await selected(d, SW.type), what).toBe('Technical');
      await expect(field(d, SW.note), what).toHaveValue('Bring your ID book.');
      expect(await d.innerText(), `${what}: no code or status shown`).not.toMatch(/INVALID_FIELD|KEY_IN_USE|KEY_REUSED|Forbidden|Not found|Conflict|Internal error|\b(400|403|404|409|500)\b/);
    }
    expect(sched!.writes).toHaveLength(answers.length);
  });

  test('AC-5 A booking whose answer is lost (booked, then the connection drops) leads to one tab read, the drawer closing and the new interview chosen, with no second POST; a request lost before it booked shows the save-failure line, keeps everything, and the next press reuses the key (S-1)', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, bonganiList());
    let d = await openSchedule(page);
    await fillBooking(d, GOOD);
    sched!.refuse({ kind: 'book', thenAbort: true });
    let reads = interviews!.reads(BONGANI).length;
    await press(d);
    await expect(d).toBeHidden();
    expect(sched!.writes, 'no second POST').toHaveLength(1);
    expect(interviews!.reads(BONGANI).length - reads, 'one tab read').toBe(1);
    await expect(page).toHaveURL(/[?&]interview=iv-booked-1(&|$)/);
    expect((await readChosen(page)).title).toBe('Technical');
    // Lost before it booked.
    d = await openSchedule(page);
    await fillBooking(d, { ...GOOD, type: 'Final' });
    sched!.refuse({ kind: 'book', abort: true });
    reads = interviews!.reads(BONGANI).length;
    await press(d);
    await expect(d.getByText(SW.saveFail, { exact: true })).toBeVisible();
    expect(interviews!.reads(BONGANI).length - reads, 'the tab is read before another press').toBe(1);
    expect(await selected(d, SW.type)).toBe('Final');
    const k = lastWrite(sched!).idempotencyKey;
    await press(d);
    await expect(d).toBeHidden();
    expect(lastWrite(sched!).idempotencyKey, 'same body, same key').toBe(k);
  });
});

// ================================================================ AC-6 Reschedule
test.describe('AC-6 Reschedule', () => {
  test.beforeEach(noBackendOnly);

  const onlineIv = (extra: Partial<Iv> = {}) => bookedIv('iv-r', sast(24, 10), {
    type: 'CULTURE_FIT', length_minutes: 90, where: 'ONLINE', place: null, video_link: 'https://meet.example.test/bongani', sequence: 2,
    panel: [person('Lerato Mokoena', 'WAITING', { person_id: 'sub-a-lerato' }), person('Sipho Ndlovu', 'WAITING', { person_id: 'sub-a-sipho' }), guest('Naledi Khumalo', 'WAITING', { email: 'naledi@fleetwise.co.za' })],
    ...extra,
  });

  test('AC-6 The drawer opens filled from the chosen interview: the W-5 title "Reschedule the culture fit interview", "{candidate} · {role}", the type read only, the day, time, length, where, link and people as read, no guest field (even with emails on), "Reason for the change"; "Reschedule" is off until something differs, and a reason alone is no change', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    sched!.panelConfig.A = { interview_emails: 'ON' };
    await onTab(fx, [onlineIv()], '?tab=interviews&interview=iv-r');
    const d = await openReschedule(page, 'CULTURE_FIT');
    await expect(d.locator('.pp-drawer__title')).toHaveText('Reschedule the culture fit interview');
    await expect(d.locator('.pp-drawer__description')).toHaveText(LINE);
    await expect(field(d, SW.type)).toHaveValue('Culture fit');
    await expect(field(d, SW.type)).toHaveAttribute('readonly', '');
    await expect(field(d, SW.date)).toHaveValue('24 Nov 2026');
    expect(await selected(d, SW.time)).toBe('10:00');
    expect(await selected(d, SW.length)).toBe('1 hour 30 minutes');
    await expect(radio(d, SW.online)).toBeChecked();
    await expect(field(d, SW.link)).toHaveValue('https://meet.example.test/bongani');
    await expect(field(d, SW.place)).toHaveCount(0);
    expect((await peopleOptions(d)).filter((x) => x.chosen).map((x) => x.name).sort()).toEqual(['Lerato Mokoena', 'Sipho Ndlovu']);
    await expect(field(d, SW.guest), 'no guest field on reschedule (D10)').toHaveCount(0);
    await expect(field(d, SW.reason)).toBeVisible();
    await expect(fieldBox(d, SW.reason).locator('.pp-field__optional')).toHaveText(SW.optional);
    await expect(d.getByText(SW.w5Line, { exact: true })).toHaveCount(0);
    await expect(mainButton(d, SW.reschedule)).toBeDisabled();
    await field(d, SW.reason).fill('Panel clash');
    await page.waitForTimeout(200);
    await expect(mainButton(d, SW.reschedule), 'a reason alone is no change').toBeDisabled();
    await pick(d, SW.length, '2 hours');
    await expect(mainButton(d, SW.reschedule)).toBeEnabled();
    await pick(d, SW.length, '1 hour 30 minutes');
    await expect(mainButton(d, SW.reschedule), 'back as read: no change').toBeDisabled();
    expect(sched!.writes).toHaveLength(0);
  });

  test('AC-6 The W-5 line "Everyone invited gets an email with the new details and an updated calendar invite." shows in the reschedule drawer only when interview_emails and candidate_interview_emails are both \'ON\' (lock check M-1)', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, [onlineIv()], '?tab=interviews&interview=iv-r');
    const cases: Array<[PanelSetting, boolean]> = [
      [{ interview_emails: 'ON', candidate_interview_emails: 'ON' }, true],
      [{ interview_emails: 'ON', candidate_interview_emails: 'OFF' }, false],
      [{ interview_emails: 'OFF', candidate_interview_emails: 'ON' }, false],
      [{ interview_emails: 'ON', candidate_interview_emails: 'ON' }, true],
    ];
    for (const [setting, shows] of cases) {
      sched!.panelConfig.A = setting;
      const d = await openReschedule(page, 'CULTURE_FIT');
      await expect(d.getByText(SW.w5Line, { exact: true }), `${JSON.stringify(setting)}`).toHaveCount(shows ? 1 : 0);
      if (shows) await expect(d.getByText(SW.w5Line, { exact: true })).toBeVisible();
      await cancelButton(d).click();
      await expect(d).toBeHidden();
    }
    expect(sched!.writes).toHaveLength(0);
  });

  test('AC-6 A panel person the people read does not offer (they left the panel group) stays chosen, shown by the name the interviews read gave; leaving the people alone is no change, and adding Thabo sends `panel` with all three ids (rule 8, T-S7, lock check M-3)', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    sched!.unlisted.A.push('sub-a-left');
    const x = onlineIv({ panel: [person('Lerato Mokoena', 'WAITING', { person_id: 'sub-a-lerato' }), person('Nomsa Zulu', 'WAITING', { person_id: 'sub-a-left' })] });
    await onTab(fx, [x], '?tab=interviews&interview=iv-r');
    const d = await openReschedule(page, 'CULTURE_FIT');
    expect((await peopleOptions(d)).filter((o) => o.chosen).map((o) => o.name).sort(), 'both stay chosen').toEqual(['Lerato Mokoena', 'Nomsa Zulu']);
    await expect(mainButton(d, SW.reschedule), 'nothing differs yet').toBeDisabled();
    await choosePeople(d, ['Thabo Khumalo']);
    await press(d, SW.reschedule);
    await expect(d).toBeHidden();
    const call = lastWrite(sched!);
    expect(call.status).toBe(200);
    expect(sortedPanel(call.body), 'nobody is dropped').toEqual(['sub-a-left', 'sub-a-lerato', 'sub-a-thabo']);
    expect({ ...(call.body as Record<string, unknown>), panel: 'x' }).toEqual({ action: 'reschedule', panel: 'x' });
  });

  test('AC-6 The request key in reschedule: a retry after a failed save with nothing changed reuses the key; a retry after a change uses a new one (lock check S-2)', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, [onlineIv()], '?tab=interviews&interview=iv-r');
    const d = await openReschedule(page, 'CULTURE_FIT');
    await pick(d, SW.length, '2 hours');
    sched!.refuse({ kind: 'reschedule', status: 500, body: { error: 'Internal error' } });
    await press(d, SW.reschedule);
    await expect(d.getByText(SW.saveFail, { exact: true })).toBeVisible();
    sched!.refuse({ kind: 'reschedule', status: 500, body: { error: 'Internal error' } });
    await press(d, SW.reschedule);
    const [a, b] = sched!.writes.slice(-2);
    expect(b.idempotencyKey, 'unchanged retry: same key').toBe(a.idempotencyKey);
    await pick(d, SW.length, '1 hour');
    await press(d, SW.reschedule);
    await expect(d).toBeHidden();
    const c = lastWrite(sched!);
    expect(c.status).toBe(200);
    expect(c.body).toEqual({ action: 'reschedule', length_minutes: 60 });
    expect(c.idempotencyKey, 'changed body: new key').not.toBe(a.idempotencyKey);
    expect(sched!.writes).toHaveLength(3);
  });

  test('AC-6 Each single change sends `action: \'reschedule\'` plus only that change (`at`; `length_minutes`; `where` with its place or link; `place` alone; `panel` as the full list; `reason_note` only when filled), never `type` or `guest_email`; 200 closes the drawer, reads the tab again and keeps the interview chosen', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    sched!.panelConfig.A = { interview_emails: 'ON' };
    await onTab(fx, [bookedIv('iv-a', sast(20, 9), { type: 'PHONE_SCREEN' }), onlineIv(), bookedIv('iv-z', sast(28, 9), { type: 'FINAL' })], '?tab=interviews&interview=iv-r');
    const steps: Array<[string, (d: Locator) => Promise<void>, Record<string, unknown>]> = [
      ['the day', (d) => typeDate(d, '26 Nov 2026'), { at: '2026-11-26T10:00:00+02:00' }],
      ['the time', (d) => pick(d, SW.time, '14:30'), { at: '2026-11-26T14:30:00+02:00' }],
      ['the length, with a reason', async (d) => { await pick(d, SW.length, '2 hours'); await field(d, SW.reason).fill('  Panel clash  '); }, { length_minutes: 120, reason_note: 'Panel clash' }],
      ['the link alone', (d) => field(d, SW.link).fill('https://meet.example.test/new-room'), { video_link: 'https://meet.example.test/new-room' }],
      ['where, to in person', async (d) => { await radio(d, SW.inPerson).check(); await field(d, SW.place).fill('  Boardroom 2 '); }, { where: 'IN_PERSON', place: 'Boardroom 2' }],
      ['the place alone', (d) => field(d, SW.place).fill('Boardroom 3'), { place: 'Boardroom 3' }],
      ['where, back online', async (d) => { await radio(d, SW.online).check(); await field(d, SW.link).fill('https://meet.example.test/again'); }, { where: 'ONLINE', video_link: 'https://meet.example.test/again' }],
      ['the people', (d) => choosePeople(d, ['Thabo Khumalo']), { panel: ['sub-a-lerato', 'sub-a-sipho', 'sub-a-thabo'] }],
    ];
    for (const [what, change, sent] of steps) {
      const reads = interviews!.reads(BONGANI).length;
      const d = await openReschedule(page, 'CULTURE_FIT');
      await change(d);
      await press(d, SW.reschedule);
      await expect(d, what).toBeHidden();
      const call = lastWrite(sched!);
      expect(call.method, what).toBe('PATCH');
      expect(call.path, what).toBe(`/v1/candidates/${BONGANI}/interviews/iv-r`);
      const body = call.body as Record<string, unknown>;
      if ('panel' in sent) {
        expect(sortedPanel(body), what).toEqual([...(sent['panel'] as string[])].sort());
        expect({ ...body, panel: 'x' }, what).toEqual({ action: 'reschedule', panel: 'x' });
      } else expect(body, what).toEqual({ action: 'reschedule', ...sent });
      expect(call.status, what).toBe(200);
      expect(call.idempotencyKey, what).toBeTruthy();
      expect(interviews!.reads(BONGANI).length - reads, `${what}: the tab reads again`).toBe(1);
      await expect.poll(async () => (await readRows(page))[await chosenIndex(page)]?.text ?? '', `${what}: the same interview stays chosen`).toContain('Culture fit');
      await expect(page).toHaveURL(/[?&]interview=iv-r(&|$)/);
    }
    expect(new Set(sched!.writes.map((c) => c.idempotencyKey)).size, 'a new key per opening').toBe(steps.length);
  });

  test('AC-6 HAS_FEEDBACK (feedback given meanwhile) shows W-9c at the top of the drawer and turns "Reschedule" off; the tab reads again and the Reschedule button is gone once closed. NOT_ALLOWED_NOW shows the save-failure line and reads the tab again; INVALID_FIELD shows the field\'s message; anything else shows the save-failure line with everything kept', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    const x = onlineIv();
    await onTab(fx, [x, bookedIv('iv-s', sast(26, 9), { type: 'FINAL' })], '?tab=interviews&interview=iv-r');
    let d = await openReschedule(page, 'CULTURE_FIT');
    await pick(d, SW.length, '2 hours');
    x.panel[0] = voted('Lerato Mokoena', 'YES', 4, null, { person_id: 'sub-a-lerato' });
    x.can = canOf({ cancel: true });
    let reads = interviews!.reads(BONGANI).length;
    await press(d, SW.reschedule);
    expect(lastWrite(sched!).status).toBe(409);
    await expect(d.getByText(SW.hasFeedback, { exact: true })).toBeVisible();
    await expect(mainButton(d, SW.reschedule)).toBeDisabled();
    expect(interviews!.reads(BONGANI).length - reads).toBe(1);
    await cancelButton(d).click();
    await expect(d).toBeHidden();
    await quiet(page);
    await expect(rescheduleButton(page), 'can.reschedule is now false').toHaveCount(0);
    // The other interview: the other answers.
    await chooseRow(page, 1);
    d = await openReschedule(page, 'FINAL');
    await pick(d, SW.length, '45 minutes');
    await field(d, SW.reason).fill('Moved by the panel');
    sched!.refuse({ kind: 'reschedule', status: 409, body: { error: 'Conflict', code: 'NOT_ALLOWED_NOW' } });
    reads = interviews!.reads(BONGANI).length;
    await press(d, SW.reschedule);
    await expect(d.getByText(SW.saveFail, { exact: true })).toBeVisible();
    expect(interviews!.reads(BONGANI).length - reads, 'NOT_ALLOWED_NOW reads the tab again').toBe(1);
    sched!.refuse({ kind: 'reschedule', status: 400, body: { error: 'Bad request', code: 'INVALID_FIELD', field: 'length_minutes' } });
    await press(d, SW.reschedule);
    expect(await errorOf(fieldBox(d, SW.length))).toBe(SW.lengthEmpty);
    for (const [status, body] of [[500, { error: 'Internal error' }], [409, { error: 'Conflict', code: 'KEY_IN_USE' }]] as const) {
      sched!.refuse({ kind: 'reschedule', status, body });
      await press(d, SW.reschedule);
      await expect(d.getByText(SW.saveFail, { exact: true })).toBeVisible();
      expect(await selected(d, SW.length)).toBe('45 minutes');
      await expect(field(d, SW.reason)).toHaveValue('Moved by the panel');
    }
  });

  test('AC-6 (a) A started interview with no feedback (two days ago): a panel-only change sends `{ action, panel }` with no W-10a and no picker message; a new day still in the past shows W-10a (not the picker\'s message: no `min`) and sends nothing; a future time sends `at`', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, [bookedIv('iv-s', sast(17, 10), { type: 'TECHNICAL' })], '?tab=interviews&interview=iv-s');
    let d = await openReschedule(page, 'TECHNICAL');
    await expect(field(d, SW.date)).toHaveValue('17 Nov 2026');
    await choosePeople(d, ['Lerato Mokoena']);
    await press(d, SW.reschedule);
    await expect(d).toBeHidden();
    const body = lastWrite(sched!).body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['action', 'panel']);
    expect(sortedPanel(body)).toEqual(['sub-a-lerato', 'sub-a-sipho']);
    d = await openReschedule(page, 'TECHNICAL');
    await typeDate(d, '18 Nov 2026');
    await press(d, SW.reschedule);
    expect(await dateTimeErrors(d), 'a past day: W-10a, not the picker\'s "Choose a date the calendar allows."').toEqual([SW.future]);
    await typeDate(d, '19 Nov 2026');
    await pick(d, SW.time, '09:00');
    await press(d, SW.reschedule);
    expect(await dateTimeErrors(d)).toEqual([SW.future]);
    expect(sched!.writes).toHaveLength(1);
    await pick(d, SW.time, '11:00');
    await press(d, SW.reschedule);
    await expect(d).toBeHidden();
    expect(lastWrite(sched!).body).toEqual({ action: 'reschedule', at: '2026-11-19T11:00:00+02:00' });
  });

  test('AC-6 (b) An interview at 10:10 opens with "10:10" chosen in a Time list of 97 (in its sorted place); a length-only change sends no `at`; the Schedule drawer\'s list stays 96', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, [bookedIv('iv-o', sast(25, 10, 10), { type: 'TECHNICAL' })], '?tab=interviews&interview=iv-o');
    let d = await openReschedule(page, 'TECHNICAL');
    const times = (await selectOptions(d, SW.time)).map((o) => o.text);
    expect(times).toHaveLength(97);
    expect(times.slice(40, 43)).toEqual(['10:00', '10:10', '10:15']);
    expect(await selected(d, SW.time)).toBe('10:10');
    await expect(mainButton(d, SW.reschedule)).toBeDisabled();
    await pick(d, SW.time, '10:15');
    await pick(d, SW.time, '10:10');
    await expect(mainButton(d, SW.reschedule), 'back to 10:10 is no change').toBeDisabled();
    await pick(d, SW.length, '30 minutes');
    await press(d, SW.reschedule);
    await expect(d).toBeHidden();
    expect(lastWrite(sched!).body).toEqual({ action: 'reschedule', length_minutes: 30 });
    d = await openSchedule(page);
    expect((await selectOptions(d, SW.time)).map((o) => o.text)).toEqual(TIMES);
  });

  test('AC-6 (c) An old interview (length, where, place and link all null, no sequence) opens with those fields empty and "Reschedule" off; "In person" with no place shows W-N8 and sends nothing; with a place, and Length still empty, it sends `where` and `place` only; then a length alone sends `{ action, length_minutes }`', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, [bookedIv('iv-old', sast(25, 9), { type: 'BEHAVIORAL', length_minutes: null, where: null, place: null, video_link: null, sequence: null })], '?tab=interviews&interview=iv-old');
    let d = await openReschedule(page, 'BEHAVIORAL');
    expect(await selected(d, SW.length)).toBe('');
    for (const r of [SW.inPerson, SW.online]) await expect(radio(d, r)).not.toBeChecked();
    await expect(field(d, SW.place)).toHaveCount(0);
    await expect(field(d, SW.link)).toHaveCount(0);
    await expect(mainButton(d, SW.reschedule)).toBeDisabled();
    expect(await d.innerText()).not.toMatch(BAD_WORDS);
    await radio(d, SW.inPerson).check();
    await press(d, SW.reschedule);
    expect(await errorOf(fieldBox(d, SW.place))).toBe(SW.placeEmpty);
    expect(sched!.writes).toHaveLength(0);
    await field(d, SW.place).fill('Room 1');
    await press(d, SW.reschedule);
    await expect(d, 'an empty Length from the read may stay empty: not checked, not sent').toBeHidden();
    expect(sched!.writes).toHaveLength(1);
    expect(lastWrite(sched!).body).toEqual({ action: 'reschedule', where: 'IN_PERSON', place: 'Room 1' });
    d = await openReschedule(page, 'BEHAVIORAL');
    expect(await selected(d, SW.length)).toBe('');
    await expect(field(d, SW.place)).toHaveValue('Room 1');
    await pick(d, SW.length, '1 hour');
    await press(d, SW.reschedule);
    await expect(d).toBeHidden();
    expect(lastWrite(sched!).body).toEqual({ action: 'reschedule', length_minutes: 60 });
  });
});

// ================================================================ AC-7 Loading and failure
test.describe('AC-7 Loading and failure', () => {
  test.beforeEach(noBackendOnly);

  test('AC-7 While the three reads run the drawer shows pp-skeleton and the main button is off; each read happens once per opening; an answer for an earlier opening that comes back late draws nothing', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, []);
    sched!.refuse({ kind: 'people', hold: true });
    await scheduleButton(page).click();
    const d = drawerOf(page);
    await expect(d).toBeVisible();
    await expect.poll(() => sched!.heldCount).toBe(1);
    await expect(d.locator('.pp-skeleton').first()).toBeVisible();
    await expect(field(d, SW.type)).toHaveCount(0);
    await expect(mainButton(d)).toBeDisabled();
    sched!.release();
    await expect(field(d, SW.type)).toBeVisible();
    await expect(d.locator('.pp-skeleton')).toHaveCount(0);
    await quiet(page);
    for (const k of ['types', 'panelConfig', 'people'] as const) expect(sched!.of(k), `${k}: once`).toHaveLength(1);
    await cancelButton(d).click();
    await openSchedule(page);
    await quiet(page);
    for (const k of ['types', 'panelConfig', 'people'] as const) expect(sched!.of(k), `${k}: once per opening`).toHaveLength(2);
    // Closed while its people answer is still on its way; opened again; the late answer (five people) must not replace the new one (two).
    await cancelButton(d).click();
    await expect(d).toBeHidden();
    sched!.refuse({ kind: 'people', hold: true });
    await scheduleButton(page).click();
    await expect.poll(() => sched!.heldCount).toBe(1);
    await cancelButton(drawerOf(page)).click();
    await expect(drawerOf(page)).toBeHidden();
    sched!.people.A = PEOPLE_A.slice(0, 2);
    const again = await openSchedule(page);
    expect((await peopleOptions(again)).map((x) => x.name)).toEqual(PEOPLE_A.slice(0, 2).map((x) => x.name));
    sched!.people.A = [...PEOPLE_A];
    sched!.release();
    await quiet(page);
    await page.waitForTimeout(500);
    expect((await peopleOptions(again)).map((x) => x.name), 'the late answer draws nothing').toEqual(PEOPLE_A.slice(0, 2).map((x) => x.name));
  });

  const failures: Array<[string, 'types' | 'panelConfig' | 'people', Parameters<ScheduleFake['refuse']>[0]]> = [
    ['the types read answers 500', 'types', { kind: 'types', status: 500 }],
    ['the panel settings read drops', 'panelConfig', { kind: 'panelConfig', abort: true }],
    ['the people read answers 403', 'people', { kind: 'people', status: 403, body: { error: 'Forbidden' } }],
    ['the people read has the wrong shape', 'people', { kind: 'people', status: 200, body: { members: 'everyone' } }],
    ['the types read has the wrong shape', 'types', { kind: 'types', status: 200, body: { configType: 'INTERVIEW_TYPES', data: { types: 'PHONE_SCREEN' } } }],
  ];
  for (const [what, kind, refusal] of failures) {
    test(`AC-7 When ${what}, the drawer shows "Interview choices could not be loaded." with "Try again", no field, the main button off; "Try again" repeats only that read, once, and draws the fields`, async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
      await onTab(fx, []);
      sched!.refuse(refusal);
      const d = await openSchedule(page);
      await expect(d.locator('.pp-section-message--danger').filter({ hasText: SW.choicesFailed })).toBeVisible();
      await expect(field(d, SW.type)).toHaveCount(0);
      await expect(field(d, SW.panel)).toHaveCount(0);
      await expect(mainButton(d)).toBeDisabled();
      await quiet(page);
      const before = { types: sched!.of('types').length, panelConfig: sched!.of('panelConfig').length, people: sched!.of('people').length };
      await d.getByRole('button', { name: SW.tryAgain, exact: true }).click();
      await expect(field(d, SW.type)).toBeVisible();
      await expect(d.getByText(SW.choicesFailed, { exact: true })).toHaveCount(0);
      await quiet(page);
      for (const k of ['types', 'panelConfig', 'people'] as const) expect(sched!.of(k).length - before[k], `${k}: ${k === kind ? 'once more' : 'not again'}`).toBe(k === kind ? 1 : 0);
      await expect(mainButton(d)).toBeEnabled();
    });
  }

  test('AC-7 When the record page\'s options read had failed, the drawer shows W-N1; "Try again" repeats the options read too, once, and draws the fields', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    hire!.refuse({ method: 'GET', path: /\/v1\/roles\/options$/, status: 500 });
    await onTab(fx, []);
    const d = await openSchedule(page);
    await expect(d.getByText(SW.choicesFailed, { exact: true })).toBeVisible();
    await expect(field(d, SW.type)).toHaveCount(0);
    await quiet(page);
    const options = hire!.to('GET', /\/v1\/roles\/options$/).length;
    const people = sched!.of('people').length;
    await d.getByRole('button', { name: SW.tryAgain, exact: true }).click();
    await expect(field(d, SW.type)).toBeVisible();
    await quiet(page);
    expect(hire!.to('GET', /\/v1\/roles\/options$/).length - options, 'the options read once more').toBe(1);
    expect(sched!.of('people').length - people, 'the people read had not failed').toBe(0);
  });

  test('AC-7 With nobody to choose, the panel shows "No people to choose yet." and the panel check refuses on press', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    sched!.people.A = [];
    await onTab(fx, []);
    const d = await openSchedule(page);
    await expect(d.getByText(SW.noPeople, { exact: true })).toBeVisible();
    const { people: _people, ...rest } = GOOD;
    await fillBooking(d, rest);
    await press(d);
    expect(await errorOf(fieldBox(d, SW.panel))).toBe(SW.panelEmpty);
    expect(sched!.writes).toHaveLength(0);
  });
});

// ================================================================ AC-8 Company B and sign-out
test.describe('AC-8 Company B and sign-out', () => {
  test.beforeEach(noBackendOnly);

  test('AC-8 Company B\'s Recruiter on A\'s candidate with ?tab=interviews&schedule=new sees "This candidate could not be found." and no drawer, and no booking, settings or people request goes out; B\'s drawer on B\'s own candidate shows only B\'s people and types, and books for B', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    sched!.set(BONGANI, bonganiList());
    sched!.set(B_CAND, []);
    sched!.types.A = [{ key: 'NIGHT_SHIFT_WALKTHROUGH', label: 'Night shift walkthrough', optional: false }, ...DEFAULT_TYPES];
    sched!.types.B = [{ key: 'DISPATCH_RIDE_ALONG', label: 'Dispatch ride along', optional: false }, DEFAULT_TYPES[4]!];
    modules!.answers.B = ['onboarding', 'recruitment'];
    await asRecruiter(fx, WHO.recruiterB);
    for (const q of ['?tab=interviews&schedule=new', '?schedule=new']) {
      await openAt(page, BONGANI, q);
      await expect(main(page).getByText(IW.notFound, { exact: true })).toBeVisible();
      await quiet(page);
      await expect(anyDrawer(page), q).toHaveCount(0);
      expect(sched!.requests, `${q}: no booking, settings or people request`).toHaveLength(0);
      expect(await page.content()).not.toContain('Bongani');
    }
    await openAt(page, B_CAND, '?tab=interviews');
    await interviewsDrawn(page);
    const d = await openSchedule(page);
    expect((await selectOptions(d, SW.type)).map((o) => o.text)).toEqual(['Dispatch ride along', 'Final']);
    expect((await peopleOptions(d)).map((x) => x.name)).toEqual(PEOPLE_B.map((x) => x.name));
    const html = await page.content();
    for (const n of [...PEOPLE_A.map((x) => x.name), 'Night shift walkthrough']) expect(html, n).not.toContain(n);
    await fillBooking(d, { ...GOOD, type: 'Dispatch ride along', people: ['Lindiwe Peters'] });
    await press(d);
    await expect(d).toBeHidden();
    const call = lastWrite(sched!);
    expect([call.email, call.status, call.path]).toEqual([WHO.recruiterB.email, 201, `/v1/candidates/${B_CAND}/interviews`]);
    expect((call.body as Record<string, unknown>)['panel']).toEqual(['sub-b-lindiwe']);
    for (const c of sched!.requests) expect(companyIdIn(c), c.path).toEqual([]);
  });

  test('AC-8 A\'s Recruiter signs out with the drawer open (typed values, a guest address, A\'s people answer still on its way); B\'s Recruiter signs in on the page the app left (no reload) and opens B\'s drawer: no A person, type, typed value or guest address shows at any moment, also when A\'s held answer arrives late', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    sched!.panelConfig.A = { interview_emails: 'ON' };
    sched!.types.A = [{ key: 'NIGHT_SHIFT_WALKTHROUGH', label: 'Night shift walkthrough', optional: false }];
    sched!.set(B_CAND, []);
    await onTab(fx, []);
    let d = await openSchedule(page);
    await field(d, SW.note).fill('A-only typed note');
    await field(d, SW.guest).fill('a.guest@bongani-only.co.za');
    await cancelButton(d).click();
    // Open again with A's people answer held, type again, and sign out with the drawer open.
    sched!.refuse({ kind: 'people', hold: true });
    await scheduleButton(page).click();
    d = drawerOf(page);
    await expect(d).toBeVisible();
    await expect.poll(() => sched!.heldCount).toBe(1);
    await avatarButton(page).dispatchEvent('click');
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).dispatchEvent('click');
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(anyDrawer(page), 'signing out closes the drawer').toHaveCount(0);
    const aWords = ['Night shift walkthrough', 'A-only typed note', 'a.guest@bongani-only.co.za', 'Bongani', ...PEOPLE_A.map((x) => x.name)];
    await page.evaluate((words) => {
      const seen: string[] = [];
      (window as unknown as { __seenA: string[] }).__seenA = seen;
      const check = () => {
        const all = `${document.documentElement.outerHTML} ${[...document.querySelectorAll('input, textarea')].map((x) => (x as HTMLInputElement).value).join(' ')}`;
        for (const w of words) if (all.includes(w)) seen.push(`${w} at ${location.pathname}${location.search}`);
      };
      new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
      document.addEventListener('input', check, true);
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
    await inApp(page, `/hire/candidates/${B_CAND}?tab=interviews`);
    await interviewsDrawn(page);
    d = await openSchedule(page);
    sched!.release();
    await quiet(page);
    await page.waitForTimeout(500);
    expect((await peopleOptions(d)).map((x) => x.name)).toEqual(PEOPLE_B.map((x) => x.name));
    await expect(field(d, SW.note)).toHaveValue('');
    expect(await seenA(), 'nothing of A at any moment').toEqual([]);
  });
});

// ================================================================ AC-9 Words
test.describe('AC-9 Words', () => {
  test.beforeEach(noBackendOnly);

  test('AC-9 Every visible string and accessible name in the drawer, in every state (loading, failed, ready with booked types, guest and W-3, no people, check failures, the picker\'s message, the calendar open, save failed, type booked meanwhile, reschedule unchanged, has feedback, an off-grid time), is an approved word, a W-N line or a date picker word; no "⟦", "null", "undefined", "NaN" or "Invalid Date"', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    sched!.panelConfig.A = { interview_emails: 'ON', candidate_interview_emails: 'ON' };
    const fb = onlineIvFb();
    await onTab(fx, [iv('iv-1', sast(3, 9), 'COMPLETED', { type: 'PHONE_SCREEN', panel: [voted('Sipho Ndlovu', 'YES', 4)] }), bookedIv('iv-o', sast(25, 10, 10), { type: 'TECHNICAL' }), fb]);
    const typed = ['Boardroom 4', 'https://meet.example.test/x', 'naledi@', 'naledi@fleetwise.co.za', 'Bring your ID book.', '31 Nov 2026', '24 Nov 2026', 'Panel clash', 'Durban depot, 14 Quay Road', '25 Nov 2026'];
    const ok = allowedWords({ typeLabels: ['Phone screen', 'Technical', 'Behavioral', 'Culture fit', 'Final'], people: PEOPLE_A.map((x) => x.name), first: 'Bongani', extra: [...typed, LINE, 'Culture fit'] });
    const check = async (d: Locator, state: string) => {
      const words = await wordsIn(d);
      expect(words.length, `${state}: words were read`).toBeGreaterThan(0);
      expect(words.filter((w) => !ok(w)), `${state}: only allowed words`).toEqual([]);
      expect(words.join(' | '), state).not.toMatch(BAD_WORDS);
      expect(await d.evaluate((el) => el.outerHTML), state).not.toContain('⟦');
    };
    sched!.refuse({ kind: 'people', hold: true });
    await scheduleButton(page).click();
    let d = drawerOf(page);
    await expect.poll(() => sched!.heldCount).toBe(1);
    await check(d, 'loading');
    sched!.release();
    await expect(field(d, SW.type)).toBeVisible();
    await check(d, 'ready, booked types, guest and W-3');
    await press(d);
    await check(d, 'check failures');
    await typeDate(d, '31 Nov 2026');
    await press(d);
    await check(d, 'the picker\'s message');
    await d.getByRole('button', { name: SW.pickerButton, exact: true }).click();
    await expect(page.getByRole('button', { name: DAY_NAME }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /, today$/ }), 'L-1: today\'s day name ends ", today"').toHaveCount(1);
    await check(d, 'the calendar open');
    await page.getByRole('button', { name: /^Tuesday 24 November 2026/ }).click();
    await fillBooking(d, { type: 'Behavioral', time: '10:00', length: '1 hour', where: 'In person', place: 'Durban depot, 14 Quay Road', people: ['Sipho Ndlovu'], guest: 'naledi@fleetwise.co.za', note: 'Bring your ID book.' });
    sched!.refuse({ kind: 'book', status: 500 });
    await press(d);
    await expect(d.getByText(SW.saveFail, { exact: true })).toBeVisible();
    await check(d, 'save failed');
    sched!.listOf(BONGANI).push(bookedIv('iv-meanwhile', sast(27, 9), { type: 'BEHAVIORAL' }));
    await press(d);
    await expect.poll(() => errorOf(fieldBox(d, SW.type))).toBe(SW.bookedServer);
    await check(d, 'type booked meanwhile');
    await cancelButton(d).click();
    sched!.refuse({ kind: 'types', status: 500 });
    d = await openSchedule(page);
    await expect(d.getByText(SW.choicesFailed, { exact: true })).toBeVisible();
    await check(d, 'failed');
    await cancelButton(d).click();
    sched!.people.A = [];
    d = await openSchedule(page);
    await expect(d.getByText(SW.noPeople, { exact: true })).toBeVisible();
    await check(d, 'no people');
    await cancelButton(d).click();
    sched!.people.A = [...PEOPLE_A];
    await chooseRow(page, (await readRows(page)).findIndex((r) => r.text.includes('Technical')));
    d = await openReschedule(page, 'TECHNICAL');
    await check(d, 'reschedule unchanged, off-grid time');
    await cancelButton(d).click();
    await chooseRow(page, (await readRows(page)).findIndex((r) => r.text.includes('Culture fit')));
    d = await openReschedule(page, 'CULTURE_FIT');
    await pick(d, SW.length, '2 hours');
    await field(d, SW.reason).fill('Panel clash');
    fb.panel[0] = voted('Lerato Mokoena', 'YES', 4, null, { person_id: 'sub-a-lerato' });
    await press(d, SW.reschedule);
    await expect(d.getByText(SW.hasFeedback, { exact: true })).toBeVisible();
    await check(d, 'has feedback');
  });

  test('AC-9 The words table: the new lines live in interview-words.ts; the words check passes on it and fails when the row "Interview choices could not be loaded." is planted as null', async () => {
    desktopOnly('it checks files, not the page');
    const repo = join(__dirname, '..', '..', '..');
    const script = join(repo, 'scripts', 'ci', 'check-interview-words.mjs');
    const words = join(repo, 'pepla-web', 'src', 'app', 'features', 'recruitment', 'interviews', 'interview-words.ts');
    const text = readFileSync(words, 'utf8');
    const plain = text.replace(/\\'/g, '\'');
    for (const w of [SW.choicesFailed, SW.noPeople, SW.typeEmpty, SW.dateEmpty, SW.timeEmpty, SW.lengthEmpty, SW.whereEmpty, SW.placeEmpty, SW.panelEmpty, SW.sast, SW.guestHelp, SW.bookedServer, SW.hasFeedback, SW.future, SW.badLink, SW.reason, SW.w5Line]) {
      expect(plain, `interview-words.ts holds "${w}"`).toContain(w);
    }
    const run = (args: string[]): number => {
      try { execFileSync('node', [script, ...args], { cwd: repo, stdio: 'pipe' }); return 0; } catch (e) { return (e as { status?: number }).status ?? 1; }
    };
    expect(run([]), 'the check passes on the real table').toBe(0);
    const m = /(['"`])Interview choices could not be loaded\.\1/.exec(text);
    expect(m, 'the row is a string in the table').toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), 'int-ui-02-'));
    try {
      const copy = join(dir, 'interview-words.ts');
      writeFileSync(copy, text);
      expect(run([copy]), 'the check passes on an exact copy').toBe(0);
      writeFileSync(copy, text.replace(m![0], 'null'));
      expect(run([copy]), 'a planted null row fails the check').not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** A booked culture fit interview for the words test: online, two people. */
function onlineIvFb(): Iv {
  return bookedIv('iv-fb', sast(26, 10), {
    type: 'CULTURE_FIT', length_minutes: 90, where: 'ONLINE', place: null, video_link: 'https://meet.example.test/bongani',
    panel: [person('Lerato Mokoena', 'WAITING', { person_id: 'sub-a-lerato' }), person('Sipho Ndlovu', 'WAITING', { person_id: 'sub-a-sipho' })],
  });
}

// ================================================================ AC-10 Phone and keyboard
test.describe('AC-10 Phone and keyboard', () => {
  test.beforeEach(noBackendOnly);

  test('AC-10 At 390 the drawer is the full screen, every field and the main button are visible, not covered, not under the top bar, the main button at the bottom with Cancel under it, nothing scrolls sideways; at 1280 the drawer opens from the right', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    sched!.panelConfig.A = { interview_emails: 'ON' };
    await onTab(fx, bonganiList());
    const d = await openSchedule(page);
    await radio(d, SW.inPerson).check();
    await expect(d.locator('.pp-drawer, :scope').first()).toBeVisible();
    await page.waitForTimeout(600); // the drawer's slide-in
    const vp = page.viewportSize()!;
    const box = (await d.boundingBox())!;
    if (test.info().project.name === 'phone-390') {
      expect([Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)], 'full screen').toEqual([0, 0, vp.width, vp.height]);
    } else {
      expect(Math.round(box.x + box.width), 'from the right').toBe(vp.width);
      expect(box.x, 'a drawer, not the full width').toBeGreaterThan(vp.width / 3);
      expect(Math.round(box.height)).toBe(vp.height);
    }
    const problems = await d.evaluate(async (drawer) => {
      const out: string[] = [];
      const width = document.documentElement.clientWidth;
      const targets = [...drawer.querySelectorAll<HTMLElement>('.pp-field__label, legend, input:not([type="radio"]), select, textarea, .pp-radio, [role="combobox"], .pp-drawer__footer button')];
      for (const el of targets) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = el.getBoundingClientRect();
        const label = `${el.tagName.toLowerCase()} "${(el.textContent ?? (el as HTMLInputElement).name ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)}"`;
        if (r.width === 0 || r.height === 0) { out.push(`${label} is not visible`); continue; }
        if (r.left < -1 || r.right > width + 1) out.push(`${label} is cut off sideways`);
        const hit = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 1), width - 1), Math.min(Math.max(r.top + Math.min(r.height / 2, 10), 1), innerHeight - 1));
        if (hit && !el.contains(hit) && !hit.contains(el) && !(el.tagName === 'LEGEND' && el.parentElement?.contains(hit))) out.push(`${label} is covered by ${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}`);
      }
      const bar = document.querySelector('pp-top-navigation');
      const barHit = bar ? bar.getBoundingClientRect() : null;
      if (barHit && barHit.height) { const top = document.elementFromPoint(width / 2, barHit.top + barHit.height / 2); if (top && bar!.contains(top)) out.push('the top bar shows over the drawer'); }
      if (document.documentElement.scrollWidth > width + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth})`);
      const body = drawer.querySelector('.pp-drawer__body');
      if (body && body.scrollWidth > body.clientWidth + 1) out.push('the drawer body scrolls sideways');
      return out;
    });
    expect(problems).toEqual([]);
    const main_ = (await mainButton(d).boundingBox())!;
    const cancel = (await cancelButton(d).boundingBox())!;
    if (test.info().project.name === 'phone-390') {
      expect(cancel.y, 'Cancel under the main button').toBeGreaterThan(main_.y + main_.height - 1);
      expect(cancel.y + cancel.height, 'at the bottom of the screen').toBeGreaterThan(vp.height - 80);
      expect(main_.width, 'full width on a phone').toBeGreaterThan(vp.width * 0.8);
    } else {
      expect(main_.x, 'the main button last, on the right').toBeGreaterThan(cancel.x);
      expect(main_.y + main_.height, 'at the bottom').toBeGreaterThan(vp.height - 100);
    }
  });

  test('AC-10 A booking can be made with the keyboard only, from the tab button to the saved interview; Escape closes the drawer and focus returns to the button that opened it (the Interviews tab when the address opened it)', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched };
    await onTab(fx, []);
    await scheduleButton(page).focus();
    await page.keyboard.press('Enter');
    const d = drawerOf(page);
    await expect(field(d, SW.type)).toBeVisible();
    await expect(field(d, SW.type), 'focus moves to the first field').toBeFocused();
    await page.keyboard.type('T');
    await expect.poll(() => selected(d, SW.type)).toBe('Technical');
    const tabTo = async (target: Locator, what: string) => {
      for (let i = 0; i < 12; i++) {
        if (await target.evaluate((el) => el === document.activeElement)) return;
        await page.keyboard.press('Tab');
      }
      throw new Error(`Tab never reached ${what}`);
    };
    await tabTo(field(d, SW.date), 'Date');
    await page.keyboard.type('24 Nov 2026');
    await tabTo(field(d, SW.time), 'Time');
    await page.keyboard.type('10');
    await expect.poll(() => selected(d, SW.time)).toBe('10:00');
    await tabTo(field(d, SW.length), 'Length');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    await expect.poll(() => selected(d, SW.length)).toBe('1 hour');
    await tabTo(radio(d, SW.inPerson), 'In person');
    await page.keyboard.press('Space');
    await expect(radio(d, SW.inPerson)).toBeChecked();
    await tabTo(field(d, SW.place), 'Place');
    await page.keyboard.type('Boardroom 4');
    await tabTo(field(d, SW.panel), 'Panel');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'Sipho Ndlovu', exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
    // Tab leaves the people list; the design system's list may stay drawn until the drawer closes (T-S12), which a keyboard user never meets.
    await page.keyboard.press('Tab');
    await tabTo(mainButton(d), 'Schedule an interview');
    await page.keyboard.press('Enter');
    await expect(d).toBeHidden();
    expect(lastWrite(sched!).body).toEqual({ type: 'TECHNICAL', at: GOOD_AT, length_minutes: 60, where: 'IN_PERSON', place: 'Boardroom 4', panel: ['sub-a-sipho'] });
    // Escape and focus.
    await scheduleButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(field(d, SW.type)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
    await expect(scheduleButton(page), 'focus returns to the button').toBeFocused();
    await openAt(page, BONGANI, '?tab=interviews&schedule=new');
    await expect(field(d, SW.type)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
    await expect(tab(page, IW.tab), 'opened by the address: focus goes to the tab').toBeFocused();
  });
});

// ================================================================ AC-11 pepla-dev (judged after merge)
test.describe('AC-11 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-11 runs on pepla-dev only.');
  // The dev step runs every @pepla-dev test once per width and seeds once, so each width has its own candidate (T-S14,
  // INT-UI-03 spec check M-1): the phone run never finds the desktop run's booking.
  type DevIds = { candidate: string; lastName: string; booked: { id: string; type: string }; freeType: string };
  const ALL = JSON.parse(readFileSync(join(__dirname, 'support', 'int-ui', 'dev-ids-02.json'), 'utf8')) as Record<string, DevIds>;
  const devOf = (): DevIds => { const d = ALL[test.info().project.name]; if (!d) throw new Error(`dev-ids-02.json has no entry for ${test.info().project.name}`); return d; };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sastDayIn = (days: number) => { const d = new Date(Date.now() + 2 * HOUR + days * 86_400_000); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

  test('AC-11 @pepla-dev The company A HR login books one interview of the free type on the seeded candidate (three days ahead, 10:00, 1 hour, online, one panel person, no guest) and sees it chosen; then reschedules the seeded booked interview one day later and sees the new day', async ({ page, signIn, hr }) => {
    const DEV = devOf();
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto(`/hire/candidates/${DEV.candidate}?tab=interviews`);
    await expect(personHeader(page)).toBeVisible();
    await interviewsDrawn(page);
    await expect(main(page).getByText(IW.failed, { exact: true })).toHaveCount(0);
    const d = await openSchedule(page);
    const day = sastDayIn(3);
    // Dev people come from the dev logins, whose names the seed does not set: the first person offered is chosen (T-S15).
    const offered = await peopleOptions(d);
    expect(offered.length, 'GET /v1/panel-members offers at least one person on pepla-dev').toBeGreaterThan(0);
    await fillBooking(d, { type: DEV.freeType, date: day, time: '10:00', length: '1 hour', where: 'Online', link: 'https://meet.example.test/pepla-dev-int-ui-02', people: [offered[0]!.name] } as Booking);
    await press(d);
    await expect(d).toBeHidden({ timeout: 20_000 });
    await expect.poll(async () => (await readChosen(page)).title, { timeout: 15_000 }).toBe(DEV.freeType);
    expect((await readChosen(page)).text).toContain(day);
    // The seeded booked interview, one day later.
    const rows = await readRows(page);
    await chooseRow(page, rows.findIndex((r) => r.text.includes(DEV.booked.type)));
    const r = await openReschedule(page, DEV.booked.type === 'Phone screen' ? 'PHONE_SCREEN' : DEV.booked.type.toUpperCase().replace(/ /g, '_'));
    const was = await field(r, SW.date).inputValue();
    const next = new Date(Date.parse(`${was} 12:00 UTC`) + 86_400_000);
    const nextDay = `${next.getUTCDate()} ${MON[next.getUTCMonth()]} ${next.getUTCFullYear()}`;
    await typeDate(r, nextDay);
    await press(r, SW.reschedule);
    await expect(r).toBeHidden({ timeout: 20_000 });
    await expect.poll(async () => (await readChosen(page)).text, { timeout: 15_000 }).toContain(nextDay);
    test.info().annotations.push({ type: 'record', description: page.url() });
  });

  test('AC-11 @pepla-dev Company B\'s HR login opening that candidate with ?tab=interviews&schedule=new sees no drawer and no name of A. It fails when E2E_B_HR_* is not set (a skip is not a pass)', async ({ page, signIn }) => {
    const DEV = devOf();
    const email = process.env['E2E_B_HR_EMAIL'], password = process.env['E2E_B_HR_PASSWORD'];
    expect(email && password, 'E2E_B_HR_EMAIL and E2E_B_HR_PASSWORD must be set on the dev run: the company B half cannot be skipped').toBeTruthy();
    await signIn.open();
    await signIn.signInAs({ email: email!, password: password! });
    await expect(page).toHaveURL('/hr');
    await openNav(page);
    const recruitmentOn = (await navLabels(page)).includes('Candidates');
    await page.goto(`/hire/candidates/${DEV.candidate}?tab=interviews&schedule=new`);
    await quiet(page);
    if (recruitmentOn) await expect(main(page).getByText(IW.notFound, { exact: true })).toBeVisible();
    else await expect(page).toHaveURL('/hr');
    await expect(anyDrawer(page)).toHaveCount(0);
    expect(await page.content()).not.toContain(DEV.lastName);
    void readHeader;
  });
});

void lengthWords; void HOUR;
