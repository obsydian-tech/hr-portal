import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { ON_DEV, avatarButton, type SignInPage } from './support/fixtures';
import type { CognitoFake } from './support/cognito-fake';
import type { ModulesFake } from './support/mod-02/modules-fake';
import { DEFAULT_CRITERIA as ROLE_CRITERIA, WHO, enter, iso, quiet, watchErrors, type HireFake, type Who } from './support/rec-ui/harness';
import { personHeader, type RecordFake } from './support/rec-ui-02/record';
import type { EventsFake } from './support/rec-ui-02/notes';
import { IW, LIST, NEVER, canOf, chosenOf, guest, inApp, interviewsDrawn, iv, person, readChosen, readRows, rowsOf, voted, type Can, type InterviewsFake, type Iv } from './support/int-ui/interviews';
import type { ScheduleFake } from './support/int-ui/schedule';
import type { CloseFake } from './support/int-ui/close';
import {
  COMPANY_ID, DECISIONS, FW, SCALE, anyDrawer, cancelOf, captureButton, dangerOf, decide, decisionRadios, expect, fillSheet, heldIn, isOff, isPhone, lineOf, main,
  notesBox, picker, pickerChoices, pickPerson, radioTexts, setScore, sheetOf, sliderTexts, sliders, submitOf, test, wordsOf, type Snapshot, type VoteFake,
} from './support/rec-ui-03/capture';
import { KIT_CAPTURE } from './support/rec-ui-03/kit-capture';

/**
 * REC-UI-03 step 2 · HR captures feedback for a panel member: on a candidate's Interviews tab a Recruiter presses "Capture feedback" on
 * an interview the server says can take it, chooses whose feedback it is ("Feedback from"), fills the same sheet as the guest page and
 * submits one `POST /v1/interviews/{id}/votes` with `on_behalf_of`. Jira NH-229 (epic NH-223, red). Lock acceptance-lock/rec-ui-03.2
 * (one squashed commit on child lock acceptance-lock/int-ui-03.1, which sits on int-ui-02.2 and int-ui-01.3: those three take
 * "Capture feedback" out of the INT-UI lists of actions that must not show).
 * Spec: onboarding-cards/specs/REC-UI-03-next-slices.md, "Step 2" (rules 1 to 8, AC-2.1 to AC-2.11), the dev seed table and the notes at
 * the end; decisions D-RUI-03.12 to .20. The fakes answer as the merged server does (support/rec-ui-03/capture.ts). Where the spec is
 * silent, cards/rec-ui-03.2.md says what these tests take (T-F1 up).
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg (08:00 UTC), a Thursday.
 * AC-2.11 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 */

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');
const desktopOnly = (why: string) => test.skip(test.info().project.name !== 'desktop-1280', `Desktop only: ${why}`);

type Fx = {
  page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null; record: RecordFake | null;
  events: EventsFake | null; interviews: InterviewsFake | null; sched: ScheduleFake | null; closer: CloseFake | null; voter: VoteFake | null;
};

const BONGANI = 'cand-bongani';
const TENDAI = 'cand-tendai';
const B_CAND = 'cand-b2';
/** A time on a November 2026 day, given in Johannesburg hours. */
const sast = (day: number, hh: number, mm = 0) => iso(Date.UTC(2026, 10, day, hh - 2, mm));
const BAD_WORDS = /\b(null|undefined|NaN)\b|Invalid Date|\[object Object\]|⟦|\b(NOT_STARTED|ALREADY_SCORED|ALREADY_DONE|NOT_ALLOWED_NOW|INVALID_SCORES|INVALID_FIELD|STRONG_YES|STRONG_NO|on_behalf_of)\b/;
const NEVER_WORDS = /Masked|average|Passed|out of 10|Scores are advice|decides/i;

/** This interview's own criteria: none of them is the role's current set (ROLE_CRITERIA), which must never show. */
const SNAP: Snapshot = [{ key: 'forklift_safety', label: 'Forklift safety' }, { key: 'route_planning', label: 'Route planning' }, { key: 'customer_care', label: 'Talks to customers' }];
const SNAP2: Snapshot = [{ key: 'teamwork', label: 'Teamwork' }, { key: 'reliability', label: 'Reliability' }];
const SIPHO = () => person('Sipho Ndlovu', 'WAITING', { person_id: 'sub-a-sipho', due_at: sast(20, 9) });
const THABO = () => person('Thabo Khumalo', 'WAITING', { person_id: 'sub-a-thabo' });
const LERATO = () => voted('Lerato Mokoena', 'YES', 4, null, { person_id: 'sub-a-lerato' });
const NALEDI = () => guest('Naledi Guest', 'WAITING', { email: 'naledi@example.org' });
/** Started yesterday 09:00, Technical; Sipho and Thabo waiting, Lerato has given feedback, a guest waiting. */
const capIv = (id = 'iv-cap', extra: Partial<Iv> = {}): Iv => iv(id, sast(18, 9), 'SCHEDULED', {
  type: 'TECHNICAL', can: canOf({ capture_feedback: true, mark_done: true }), panel: [SIPHO(), LERATO(), THABO(), NALEDI()], ...extra,
});
const LINE = lineOf('Fleet controller', 'Technical', '18 Nov 2026');
const TITLE = FW.title('Bongani', 'Mthembu');

async function asRecruiter(fx: Fx, who: Who = WHO.recruiterA): Promise<void> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
}
async function openAt(page: Page, id: string, query = ''): Promise<void> {
  await page.goto(`/hire/candidates/${id}${query}`);
  await expect(personHeader(page).or(main(page).getByText(IW.notFound, { exact: true })).or(main(page).getByText('This candidate could not be loaded.', { exact: true })).first()).toBeVisible();
}
/** Gives each interview its snapshot (SNAP unless said), signs in as A's Recruiter and opens the candidate's tab with one chosen. */
async function onTab(fx: Fx, list: Iv[], chosen: string, cand = BONGANI, snaps: Record<string, Snapshot | 'missing'> = {}): Promise<void> {
  for (const x of list) fx.voter!.snapshot(x.id, snaps[x.id] ?? SNAP);
  fx.sched!.set(cand, list, { done: 1, total: 3 });
  await asRecruiter(fx);
  await openAt(fx.page, cand, `?tab=interviews&interview=${chosen}`);
  await interviewsDrawn(fx.page);
  await expect.poll(async () => (await readRows(fx.page)).findIndex((r) => r.selected)).toBe(list.findIndex((x) => x.id === chosen));
}
async function chooseRow(page: Page, n: number): Promise<void> {
  await rowsOf(page).nth(n).click();
  await expect.poll(async () => (await readRows(page)).findIndex((r) => r.selected), { message: `row ${n} is chosen` }).toBe(n);
}
/** Presses "Capture feedback" and waits for the sheet. */
async function openSheet(page: Page, title = TITLE): Promise<Locator> {
  await captureButton(page).click();
  const s = sheetOf(page, title);
  await expect(s).toBeVisible();
  await expect(picker(s)).toBeVisible();
  await settled(page, s);
  return s;
}
/** The sheet has stopped moving: the same box on two animation frames in a row, and at 1280 the drawer's right edge on the window's. */
async function settled(page: Page, s: Locator): Promise<void> {
  // At 1280 `s` is the drawer's dialog, the panel that slides; at 390 the page in main.
  void page;
  await expect.poll(async () => s.evaluate((el) => new Promise<boolean>((done) => {
    const box = () => { const r = el.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.width)},${Math.round(r.right)}`; };
    const a = box();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const b = box();
      const right = Math.round(el.getBoundingClientRect().right);
      done(a === b && (window.innerWidth < 768 || Math.abs(right - document.documentElement.clientWidth) <= 1 || Math.abs(right - window.innerWidth) <= 1));
    }));
  })), { message: 'the sheet has stopped moving', timeout: 10_000 }).toBe(true);
}
/** The sheet has gone: no drawer, no page heading with the title, and the tab is back. */
async function sheetGone(page: Page, title = TITLE): Promise<void> {
  await expect(page.getByRole('dialog', { name: title, exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toHaveCount(0);
  await expect(main(page).locator(LIST)).toBeVisible();
}
const press = async (s: Locator) => { await submitOf(s).click(); await quiet(s.page()); };
/** Every control in `main` by what it says. */
async function controls(page: Page): Promise<string[]> {
  return main(page).evaluate((m) => [...m.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="link"]')]
    .map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`.replace(/\s+/g, ' ').trim()));
}
/** Where focus is: 'capture' on the button, 'row:n' inside row n of the list, else the focused element's tag and text. */
async function focusAt(page: Page): Promise<string> {
  return page.evaluate((list) => {
    const a = document.activeElement as HTMLElement | null;
    if (!a) return 'none';
    if (a.matches('main button') && (a.textContent ?? '').replace(/\s+/g, ' ').trim() === 'Capture feedback') return 'capture';
    const rows = [...document.querySelectorAll(`main :is(${list}) > li`)];
    const i = rows.findIndex((li) => li === a || li.contains(a));
    return i >= 0 ? `row:${i}` : `${a.tagName.toLowerCase()} "${(a.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
  }, LIST);
}
const bodyOf = (c: { body: unknown }) => c.body as Record<string, unknown>;
const FILL = { person: 'Thabo Khumalo', scores: [5, 3, 4], decision: 'Yes', criteria: SNAP };

// ================================================================ AC-2.1 The button follows `can`
test.describe('AC-2.1 The button follows can', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2.1 For a Recruiter, "Capture feedback" shows on the chosen interview exactly when `can.capture_feedback` is true, for every status the fake sends (booked ahead, started, Done, Cancelled, Did not happen) and with every other `can` key all true and all false; never in the list rows; one button at most; "Add panel member" nowhere', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    const errors = watchErrors(page);
    const kinds: Array<[Iv['status'], string]> = [['SCHEDULED', sast(24, 10)], ['SCHEDULED', sast(18, 9)], ['COMPLETED', sast(12, 9)], ['CANCELLED', sast(13, 9)], ['DID_NOT_HAPPEN', sast(14, 9)]];
    const mixes: Array<[boolean, 'all' | 'none']> = [[true, 'none'], [true, 'all'], [false, 'all'], [false, 'none']];
    const list: Iv[] = [];
    kinds.forEach(([status, at], k) => mixes.forEach(([cap, rest], m) => {
      const others = canOf(rest);
      list.push(iv(`iv-k${k}m${m}`, iso(Date.parse(at) + (k * 10 + m) * 60_000), status, {
        type: 'TECHNICAL', closed_reason: status === 'CANCELLED' ? 'CANDIDATE_ASKED' : status === 'DID_NOT_HAPPEN' ? 'OTHER' : status === 'COMPLETED' ? 'FEEDBACK_GIVEN_ANOTHER_WAY' : null,
        can: { ...others, capture_feedback: cap }, panel: [SIPHO(), LERATO()],
      }));
    }));
    list.sort((a, b) => a.at!.localeCompare(b.at!));
    await onTab(fx, list, list[0]!.id);
    for (let i = 0; i < list.length; i++) {
      await chooseRow(page, i);
      const x = list[i]!;
      const where = `${x.id} ${x.status} ${JSON.stringify(x.can)}`;
      await expect(captureButton(page), where).toHaveCount(x.can.capture_feedback ? 1 : 0);
      expect((await controls(page)).filter((c) => c.includes(FW.capture)), `${where}: one button at most`).toHaveLength(x.can.capture_feedback ? 1 : 0);
      const inList = await main(page).locator(LIST).evaluate((l) => [...l.querySelectorAll('button, a, [role="button"], [role="menuitem"]')].map((b) => (b.textContent ?? '').trim()));
      expect(inList.filter((t) => t.includes(FW.capture)), `${where}: none in the list rows`).toEqual([]);
      expect((await controls(page)).filter((c) => c.includes('Add panel member')), where).toEqual([]);
    }
    expect(voter!.posts).toHaveLength(0);
    expect(errors, 'no console error').toEqual([]);
  });

  test('AC-2.1 With `can.capture_feedback` true but no `criteria_snapshot` in the answer, or an empty one, no button shows (D-RUI-03.19); with a non-empty one it does', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    const list = [capIv('iv-none', { at: sast(17, 9) }), capIv('iv-empty', { at: sast(17, 11) }), capIv('iv-full', { at: sast(18, 9) })];
    await onTab(fx, list, 'iv-none', BONGANI, { 'iv-none': 'missing', 'iv-empty': [] });
    for (const [i, want] of [[0, 0], [1, 0], [2, 1]] as const) {
      await chooseRow(page, i);
      await expect(captureButton(page), list[i]!.id).toHaveCount(want);
    }
  });

  test('AC-2.1 The button sits under the panel lines of the chosen interview; on a phone it is full width', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv()], 'iv-cap');
    const people = await page.locator('main .pp-person').all();
    expect(people.length, 'the four panel lines').toBeGreaterThanOrEqual(4);
    const last = (await people[people.length - 1]!.boundingBox())!;
    const b = (await captureButton(page).boundingBox())!;
    expect(b.y, 'under the last panel line').toBeGreaterThanOrEqual(last.y + last.height - 1);
    if (isPhone()) {
      const card = (await chosenOf(page).boundingBox())!;
      expect(b.width, 'full width on a phone').toBeGreaterThan(card.width * 0.8);
    }
  });
});

// ================================================================ AC-2.2 The sheet
test.describe('AC-2.2 The sheet', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2.2 The sheet shows the title, the role and interview line, "Feedback from" first, one slider per criterion of that interview\'s snapshot in its order (1 to 5, step 1; never the role\'s current criteria), "Decision" with the four tiles and their helper lines in order, Notes "(optional)", Cancel and "Submit feedback"; nothing chosen or checked; no "Scores are advice" line; no null, undefined, NaN or Invalid Date', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    const errors = watchErrors(page);
    await onTab(fx, [capIv()], 'iv-cap');
    const s = await openSheet(page);
    await expect(s.getByRole('heading', { name: TITLE, exact: true })).toBeVisible();
    await expect(s.getByText(LINE, { exact: true })).toBeVisible();
    // "Feedback from" comes first: before the first slider.
    const order = await s.evaluate((root, label) => {
      const sel = [...root.querySelectorAll('select, input, [role="combobox"]')].find((e) => (e as HTMLSelectElement).labels?.[0]?.textContent?.trim() === label);
      const slider = root.querySelector('input[type="range"]');
      return !!sel && !!slider && !!(sel.compareDocumentPosition(slider) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, FW.from);
    expect(order, '"Feedback from" sits above the sliders').toBe(true);
    const st = await sliderTexts(s);
    expect(st.map((x) => x.label), 'one slider per snapshot entry, in order').toEqual(SNAP.map((c) => c.label));
    for (const x of st) expect([x.min, x.max, x.step], x.label).toEqual(['1', '5', '1']);
    for (const c of [...ROLE_CRITERIA.map((r) => r.label).filter((l) => l !== 'Technical'), NEVER.criteria]) await expect(s.getByText(c, { exact: true }), `the role's "${c}" never shows`).toHaveCount(0);
    await expect(s.getByText(FW.decision, { exact: true })).toBeVisible();
    expect(await radioTexts(s), 'Decision: four tiles, in order, with their helper lines, none checked').toEqual(DECISIONS.map((d) => ({ label: d.label, help: d.help, checked: false })));
    await expect(notesBox(s)).toBeVisible();
    await expect(notesBox(s)).toHaveValue('');
    await expect(s.getByText(FW.optional, { exact: true })).toBeVisible();
    await expect(cancelOf(s)).toBeVisible();
    await expect(submitOf(s)).toBeVisible();
    expect((await pickerChoices(s)).chosen, 'nobody chosen').toBe('');
    const text = await s.innerText();
    expect(text).not.toMatch(NEVER_WORDS);
    expect(text).not.toMatch(BAD_WORDS);
    expect(errors, 'no console error').toEqual([]);
  });

  test('AC-2.2 Each slider says its value in the approved words, shown and read out: 1 to 5 give "n out of 5, word"', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv()], 'iv-cap');
    const s = await openSheet(page);
    for (let v = 1; v <= 5; v++) {
      await setScore(s, 'Route planning', v);
      const row = (await sliderTexts(s)).find((x) => x.label === 'Route planning')!;
      expect([row.shown, row.spoken], `value ${v}`).toEqual([SCALE[v - 1], SCALE[v - 1]]);
    }
  });

  test('AC-2.2 The sheet is the chosen interview\'s own: another interview with other criteria shows those; with no role title the line starts at the type; an interview at 01:30 Johannesburg time shows Johannesburg\'s day; another candidate shows their own name', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    // 17 Nov 23:30 UTC is 18 Nov 01:30 in Johannesburg.
    const list = [capIv('iv-a'), capIv('iv-b', { type: 'CULTURE_FIT', at: '2026-11-17T23:30:00.000Z' })];
    list.sort((a, b) => a.at!.localeCompare(b.at!));
    await onTab(fx, list, 'iv-a', BONGANI, { 'iv-b': SNAP2 });
    await chooseRow(page, list.findIndex((x) => x.id === 'iv-b'));
    let s = await openSheet(page);
    expect((await sliderTexts(s)).map((x) => x.label)).toEqual(['Teamwork', 'Reliability']);
    await expect(s.getByText(lineOf('Fleet controller', 'Culture fit', '18 Nov 2026'), { exact: true })).toBeVisible();
    await cancelOf(s).click();
    await sheetGone(page);
    // No role title.
    record!.set(TENDAI, { role_title: null });
    sched!.set(TENDAI, [capIv('iv-t')], { done: 0, total: 2 });
    voter!.snapshot('iv-t', SNAP);
    await openAt(page, TENDAI, '?tab=interviews&interview=iv-t');
    await interviewsDrawn(page);
    s = await openSheet(page, FW.title('Tendai', 'Ncube'));
    await expect(s.getByText(lineOf(null, 'Technical', '18 Nov 2026'), { exact: true })).toBeVisible();
    expect(await s.innerText()).not.toMatch(/(^|\n)\s*·|Fleet controller|Bongani/);
  });
});

// ================================================================ AC-2.3 The picker
test.describe('AC-2.3 The picker', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2.3 "Feedback from" lists exactly the people on the panel who are waiting, by name, in the answer\'s order: not the person who has given feedback, not the guest, nobody who is not in the answer; nothing is chosen at the start, also when only one person is waiting', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    // The answer's order is not alphabetical, so a picker that sorts by name fails.
    const list = [capIv('iv-two', { at: sast(17, 9), panel: [THABO(), LERATO(), SIPHO(), NALEDI()] }), capIv('iv-one', { at: sast(18, 9), panel: [LERATO(), NALEDI(), THABO()] })];
    await onTab(fx, list, 'iv-two');
    let s = await openSheet(page);
    expect(await pickerChoices(s)).toEqual({ choices: ['Thabo Khumalo', 'Sipho Ndlovu'], chosen: '' });
    await cancelOf(s).click();
    await sheetGone(page);
    await chooseRow(page, 1);
    s = await openSheet(page);
    expect(await pickerChoices(s), 'one person waiting: still nobody chosen').toEqual({ choices: ['Thabo Khumalo'], chosen: '' });
    await expect(submitOf(s)).toBeDisabled();
  });

  test('AC-2.3 Submit stays off until a person, every criterion and the Decision are set (a slider never moved does not count, even at 1); then it is on, and there is no vote gate: "Strong no" with every score 5 is sent', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv()], 'iv-cap');
    const s = await openSheet(page);
    expect(await isOff(submitOf(s)), 'nothing set').toBe(true);
    await pickPerson(s, 'Sipho Ndlovu');
    expect(await isOff(submitOf(s)), 'a person only').toBe(true);
    await setScore(s, 'Route planning', 5);
    await setScore(s, 'Talks to customers', 5);
    await decide(s, 'Strong no');
    expect(await isOff(submitOf(s)), 'the first slider never moved').toBe(true);
    await setScore(s, 'Forklift safety', 1);
    expect(await isOff(submitOf(s)), 'the first slider set to 1').toBe(false);
    await setScore(s, 'Forklift safety', 5);
    expect(await isOff(submitOf(s))).toBe(false);
    await press(s);
    expect(voter!.posts).toHaveLength(1);
    expect(bodyOf(voter!.posts[0]!)).toMatchObject({ rating: 'STRONG_NO', scores: { forklift_safety: 5, route_planning: 5, customer_care: 5 } });
    expect(voter!.posts[0]!.status).toBe(201);
  });

  test('AC-2.3 Submit stays off with every criterion and a person but no Decision, and with a Decision and every criterion but no person', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv()], 'iv-cap');
    let s = await openSheet(page);
    await pickPerson(s, 'Sipho Ndlovu');
    for (const c of SNAP) await setScore(s, c.label, 3);
    expect(await isOff(submitOf(s)), 'no Decision').toBe(true);
    await cancelOf(s).click();
    await sheetGone(page);
    s = await openSheet(page);
    for (const c of SNAP) await setScore(s, c.label, 3);
    await decide(s, 'No');
    expect(await isOff(submitOf(s)), 'no person').toBe(true);
    await submitOf(s).click({ force: true }).catch(() => undefined);
    await quiet(page);
    expect(voter!.posts, 'nothing is sent').toHaveLength(0);
  });
});

// ================================================================ AC-2.4 Submit
test.describe('AC-2.4 Submit', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2.4 One press sends exactly one POST to /v1/interviews/{that id}/votes with the caller\'s own sign-in, body keys exactly scores, rating and on_behalf_of (comment only when Notes is typed); scores has exactly the snapshot\'s keys as whole numbers 1 to 5; on_behalf_of is the chosen person\'s id; an Idempotency-Key; no company id, voter id or name anywhere in the request', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv(), capIv('iv-other', { at: sast(18, 14) })], 'iv-cap');
    const s = await openSheet(page);
    await fillSheet(s, FILL);
    await press(s);
    expect(voter!.posts).toHaveLength(1);
    const c = voter!.posts[0]!;
    expect(c.path).toMatch(/\/v1\/interviews\/iv-cap\/votes$/);
    expect(c.email).toBe(WHO.recruiterA.email);
    expect(Object.keys(bodyOf(c)).sort()).toEqual(['on_behalf_of', 'rating', 'scores']);
    expect(bodyOf(c)).toEqual({ scores: { forklift_safety: 5, route_planning: 3, customer_care: 4 }, rating: 'YES', on_behalf_of: 'sub-a-thabo' });
    for (const v of Object.values(bodyOf(c)['scores'] as Record<string, unknown>)) expect(Number.isInteger(v)).toBe(true);
    expect(c.idempotencyKey, 'an Idempotency-Key').toBeTruthy();
    expect(c.query).toEqual({});
    const sub = cognito!.subOf(WHO.recruiterA.email)!;
    for (const never of [...Object.values(COMPANY_ID), 'tenant', 'Thandi', 'Thabo Khumalo', 'Bongani', BONGANI]) {
      expect(c.raw.replace(/^Bearer [^"]+/m, '').replace(/"authorization":"[^"]*"/, ''), `the request carries no "${never}"`).not.toContain(never);
    }
    expect(JSON.stringify(bodyOf(c)), 'no voter id in the body').not.toContain(sub);
  });

  test('AC-2.4 Notes typed go as `comment`, exactly as typed, at most 2000 characters (the field takes no more)', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv()], 'iv-cap');
    const s = await openSheet(page);
    await fillSheet(s, { ...FILL, notes: 'Knows the Durban routes well.' });
    await notesBox(s).fill('x'.repeat(2100));
    expect((await notesBox(s).inputValue()).length, 'the field takes at most 2000').toBeLessThanOrEqual(2000);
    // A full 2000 characters, with spaces and a line break at both ends: sent whole, not trimmed or cut.
    const head = '  Knows the Durban routes well.\nAsked good questions. ';
    const tail = ' Would start on Monday.\n ';
    const full = head + 'r'.repeat(2000 - head.length - tail.length) + tail;
    expect(full).toHaveLength(2000);
    await notesBox(s).fill(full);
    expect(await notesBox(s).inputValue()).toBe(full);
    await press(s);
    expect(voter!.posts).toHaveLength(1);
    expect(Object.keys(bodyOf(voter!.posts[0]!)).sort()).toEqual(['comment', 'on_behalf_of', 'rating', 'scores']);
    expect(bodyOf(voter!.posts[0]!)['comment'], 'exactly as typed, all 2000 characters').toBe(full);
  });

  test('AC-2.4 A retry after a failure sends the same Idempotency-Key; opening the sheet again gives a new one; a double press sends one request', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv()], 'iv-cap');
    let s = await openSheet(page);
    await fillSheet(s, FILL);
    voter!.refuse({ status: 500 });
    await press(s);
    await expect(dangerOf(s)).toContainText(FW.saveFail);
    voter!.refuse({ abort: true });
    await press(s);
    expect(voter!.posts).toHaveLength(2);
    expect(voter!.posts[1]!.idempotencyKey, 'the same key on a retry').toBe(voter!.posts[0]!.idempotencyKey);
    await cancelOf(s).click();
    await sheetGone(page);
    s = await openSheet(page);
    await fillSheet(s, FILL);
    voter!.refuse({ hold: true });
    await submitOf(s).click();
    await expect.poll(() => voter!.heldCount).toBe(1);
    await submitOf(s).click({ force: true, timeout: 2000 }).catch(() => undefined);
    await submitOf(s).dblclick({ force: true, timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    voter!.release();
    await quiet(page);
    expect(voter!.posts, 'one request for the presses while the first was on its way').toHaveLength(3);
    expect(voter!.posts[2]!.idempotencyKey, 'a new opening, a new key').not.toBe(voter!.posts[0]!.idempotencyKey);
    expect(voter!.posts[2]!.idempotencyKey).toBeTruthy();
  });
});

// ================================================================ AC-2.5 After success
test.describe('AC-2.5 After success', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2.5 201: the sheet closes, the interviews are read exactly once more, the person\'s line shows what that answer says ("Captured by Thandi Dube for Thabo", "Yes · 4 out of 5"), the same interview stays chosen, and focus is on "Capture feedback" (someone is still waiting)', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv('iv-old', { at: sast(17, 9) }), capIv()], 'iv-cap');
    const s = await openSheet(page);
    await fillSheet(s, FILL);
    const before = interviews!.reads(BONGANI).length;
    await press(s);
    await sheetGone(page);
    await expect.poll(() => interviews!.reads(BONGANI).length).toBe(before + 1);
    await quiet(page);
    expect(interviews!.reads(BONGANI).length, 'read once more, not twice').toBe(before + 1);
    expect((await readRows(page)).findIndex((r) => r.selected), 'the same interview stays chosen').toBe(1);
    const thabo = (await readChosen(page)).people.find((p) => p.text.includes('Thabo Khumalo'))!;
    expect(thabo.text).toContain('Captured by Thandi Dube for Thabo');
    expect(thabo.text).toContain('Yes · 4 out of 5');
    await expect(captureButton(page)).toBeVisible();
    await expect.poll(() => focusAt(page)).toBe('capture');
  });

  test('AC-2.5 The page draws only what the new read says, never its own copy of what was sent: while the read is held the line is unchanged; when it comes with other words those show; when the last waiting person is captured the button goes and focus is on the interview\'s row', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    const one = capIv('iv-cap', { panel: [LERATO(), THABO()] });
    await onTab(fx, [capIv('iv-old', { at: sast(17, 9) }), one], 'iv-cap');
    const s = await openSheet(page);
    await fillSheet(s, FILL);
    interviews!.refuse({ hold: true, id: BONGANI });
    await press(s);
    await expect.poll(() => interviews!.heldCount).toBe(1);
    await page.waitForTimeout(300);
    expect(await main(page).innerText(), 'nothing drawn from the page\'s own copy').not.toContain('Captured by');
    // The server's line says something else than what was sent.
    one.panel[1]!.vote = { rating: 'NO', overall: 2.7, on_behalf_by_name: 'Naledi Zungu' };
    interviews!.release();
    await expect.poll(async () => (await readChosen(page)).text).toContain('Captured by Naledi Zungu for Thabo');
    const c = await readChosen(page);
    const thabo = c.people.find((p) => p.text.includes('Thabo Khumalo'))!;
    expect(thabo.text).toContain('No · 2.7 out of 5');
    expect(c.text).not.toContain('Thandi Dube');
    expect(thabo.text, 'Thabo\'s line is the server\'s, not what was sent').not.toContain('Yes');
    await expect(captureButton(page), 'nobody is waiting: no button').toHaveCount(0);
    await expect.poll(() => focusAt(page)).toBe('row:1');
  });
});

// ================================================================ AC-2.6 Refusals
test.describe('AC-2.6 Refusals', () => {
  test.beforeEach(noBackendOnly);

  const REFUSALS: Array<[string, { status?: number; body?: unknown; abort?: boolean }, string]> = [
    ['409 NOT_STARTED', { status: 409, body: { error: 'Conflict', code: 'NOT_STARTED' } }, FW.notStarted],
    ['409 ALREADY_SCORED', { status: 409, body: { error: 'Conflict', code: 'ALREADY_SCORED' } }, FW.saveFail],
    ['409 ALREADY_DONE', { status: 409, body: { error: 'Conflict', code: 'ALREADY_DONE' } }, FW.saveFail],
    ['409 NOT_ALLOWED_NOW', { status: 409, body: { error: 'Conflict', code: 'NOT_ALLOWED_NOW' } }, FW.saveFail],
    ['400 INVALID_SCORES', { status: 400, body: { error: 'Bad request', code: 'INVALID_SCORES' } }, FW.saveFail],
    ['400 on_behalf_of', { status: 400, body: { error: 'Bad request', code: 'INVALID_FIELD', field: 'on_behalf_of' } }, FW.saveFail],
    ['403', { status: 403, body: { error: 'Forbidden' } }, FW.saveFail],
    ['404', { status: 404, body: { error: 'Not found' } }, FW.saveFail],
    ['500', { status: 500, body: { error: 'Internal error' } }, FW.saveFail],
    ['a dropped connection', { abort: true }, FW.saveFail],
  ];

  test('AC-2.6 Every refusal keeps the sheet open with the person, scores, Decision and Notes as typed, and shows one line in a danger message above the buttons: W-9b for 409 NOT_STARTED, "Your change could not be saved. Try again." for 409 ALREADY_SCORED, ALREADY_DONE and NOT_ALLOWED_NOW, 400, 403, 404, 500 and a dropped connection; no code shows', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv()], 'iv-cap');
    const s = await openSheet(page);
    await fillSheet(s, { ...FILL, notes: 'Typed before the refusal' });
    const typed = await heldIn(s);
    expect(typed).toEqual({ person: 'Thabo Khumalo', values: ['5', '3', '4'], decision: 'Yes', notes: 'Typed before the refusal' });
    for (const [what, r, words] of REFUSALS) {
      voter!.refuse(r);
      await press(s);
      await expect(s, `${what}: the sheet stays`).toBeVisible();
      await expect(dangerOf(s), what).toHaveCount(1);
      await expect(dangerOf(s), what).toContainText(words);
      const other = words === FW.saveFail ? FW.notStarted : FW.saveFail;
      expect(await s.innerText(), `${what}: only its own line`).not.toContain(other);
      expect(await s.innerText(), `${what}: no code`).not.toMatch(BAD_WORDS);
      expect(await heldIn(s), `${what}: what was typed stays`).toEqual(typed);
      await expect(dangerOf(s), `${what}: shown`).toBeVisible();
      const above = await dangerOf(s).evaluate((m, name) => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === name);
        return !!b && !!(m.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      }, FW.submit);
      expect(above, `${what}: the message comes before the buttons`).toBe(true);
    }
    expect(voter!.posts).toHaveLength(REFUSALS.length);
    expect(voter!.votes.size, 'nothing saved').toBe(0);
  });

  test('AC-2.6 The real refusals of the server: a booked interview that has not started (the server still says it can) gives W-9b; with the company\'s "HR may enter for a panel member" off the server refuses 403 and the save-failure line shows; nothing is saved', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv('iv-cap'), capIv('iv-ahead', { at: sast(24, 10) })], 'iv-ahead');
    let s = await openSheet(page);
    await fillSheet(s, FILL);
    await press(s);
    await expect(dangerOf(s)).toContainText(FW.notStarted);
    expect(voter!.posts.at(-1)!.status).toBe(409);
    await cancelOf(s).click();
    await sheetGone(page);
    sched!.panelConfig.A = { hrMayEnterForMember: false };
    await chooseRow(page, 0);
    s = await openSheet(page);
    await fillSheet(s, FILL);
    await press(s);
    expect(voter!.posts.at(-1)!.status).toBe(403);
    await expect(dangerOf(s)).toContainText(FW.saveFail);
    expect(voter!.votes.size).toBe(0);
  });
});

// ================================================================ AC-2.7 Desktop and phone
test.describe('AC-2.7 Desktop and phone', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2.7 At 1280 the sheet is a drawer from the right over the tab; at 390 it is a full page (its title the page heading, no drawer, the tab\'s list gone) with the same content; every heading, field and button is visible, not covered, not under the top bar, nothing scrolls sideways', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv()], 'iv-cap');
    const s = await openSheet(page);
    await settled(page, s); // the drawer's slide-in has ended
    const vp = page.viewportSize()!;
    if (isPhone()) {
      await expect(anyDrawer(page), 'no drawer on a phone').toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(main(page).getByRole('heading', { level: 1, name: TITLE, exact: true })).toBeVisible();
      await expect(main(page).locator(LIST), 'the full page, not the tab').toHaveCount(0);
    } else {
      await expect(s).toHaveClass(/\bpp-drawer\b/);
      const box = (await s.boundingBox())!;
      expect(Math.round(box.x + box.width), 'from the right').toBe(vp.width);
      expect(box.x, 'a drawer, not the full width').toBeGreaterThan(vp.width / 3);
    }
    const problems = await s.evaluate(async (root) => {
      const out: string[] = [];
      const width = document.documentElement.clientWidth;
      const targets = [...root.querySelectorAll<HTMLElement>('h1, h2, .pp-field__label, legend, select, input[type="range"], textarea, .pp-radio, button')];
      for (const el of targets) {
        if (el.closest('pp-top-navigation, .pp-top-navigation')) continue;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = el.getBoundingClientRect();
        const label = `${el.tagName.toLowerCase()} "${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)}"`;
        if (r.width === 0 || r.height === 0) { out.push(`${label} is not visible`); continue; }
        if (r.left < -1 || r.right > width + 1) out.push(`${label} is cut off sideways`);
        const hit = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 1), width - 1), Math.min(Math.max(r.top + Math.min(r.height / 2, 10), 1), innerHeight - 1));
        if (hit && !el.contains(hit) && !hit.contains(el) && !(el.tagName === 'LEGEND' && el.parentElement?.contains(hit)) && !(el.classList.contains('pp-radio') && el.contains(hit))) {
          out.push(`${label} is covered by ${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}`);
        }
      }
      if (document.documentElement.scrollWidth > width + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth})`);
      return out;
    });
    expect(problems).toEqual([]);
    const sub = (await submitOf(s).boundingBox())!;
    const can = (await cancelOf(s).boundingBox())!;
    if (isPhone()) expect(can.y, 'Cancel under Submit feedback on a phone (kit)').toBeGreaterThan(sub.y + sub.height - 1);
    else expect(sub.x, 'Submit feedback last, on the right').toBeGreaterThan(can.x);
  });

  test('AC-2.7 Cancel sends nothing, closes the sheet (on a phone, back to the tab) and puts focus back on "Capture feedback"', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv()], 'iv-cap');
    const s = await openSheet(page);
    await fillSheet(s, FILL);
    await cancelOf(s).click();
    await sheetGone(page);
    await expect.poll(() => focusAt(page)).toBe('capture');
    expect((await readRows(page)).findIndex((r) => r.selected)).toBe(0);
    expect(voter!.calls, 'nothing is sent').toHaveLength(0);
    // Opened again, the sheet starts empty.
    const again = await openSheet(page);
    expect(await heldIn(again)).toEqual({ person: '', values: expect.any(Array) as unknown as string[], decision: null, notes: '' });
    await expect(submitOf(again)).toBeDisabled();
  });

  test('AC-2.7 Escape closes the drawer, sends nothing and puts focus back on "Capture feedback"', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    desktopOnly('Escape closes a drawer; on a phone the sheet is a page and Cancel leaves it');
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv()], 'iv-cap');
    const s = await openSheet(page);
    await fillSheet(s, FILL);
    await page.keyboard.press('Escape');
    await sheetGone(page);
    await expect.poll(() => focusAt(page)).toBe('capture');
    expect(voter!.calls).toHaveLength(0);
  });
});

// ================================================================ AC-2.8 Company B
test.describe('AC-2.8 Company B', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2.8 A company B Recruiter whose answer names company A\'s interview id submits: the server says 404, the save-failure line shows, the sheet stays, nothing of A is drawn, the request carries only B\'s own sign-in and no company id, and A\'s interview is unchanged', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    // A's real interview, and B's candidate shown with the same interview id (a forged display: the server holds none under B).
    const a = capIv('iv-cap');
    voter!.snapshot('iv-cap', SNAP);
    sched!.set(BONGANI, [a], { done: 1, total: 3 });
    voter!.forge(B_CAND);
    modules!.answers.B = ['onboarding', 'recruitment'];
    sched!.set(B_CAND, [capIv('iv-cap', { panel: [person('Musa Dlamini', 'WAITING', { person_id: 'sub-a-sipho' })] })], { done: 0, total: 2 });
    await asRecruiter(fx, WHO.recruiterB);
    await openAt(page, B_CAND, '?tab=interviews&interview=iv-cap');
    await interviewsDrawn(page);
    const s = await openSheet(page, FW.title('Mandla', 'Cele'));
    await fillSheet(s, { ...FILL, person: 'Musa Dlamini' });
    await press(s);
    expect(voter!.posts).toHaveLength(1);
    const c = voter!.posts[0]!;
    expect([c.status, c.email], 'B\'s own sign-in, refused 404').toEqual([404, WHO.recruiterB.email]);
    for (const id of Object.values(COMPANY_ID)) expect(c.raw).not.toContain(id);
    expect(Object.keys(bodyOf(c)).sort(), 'no company in the body').toEqual(['on_behalf_of', 'rating', 'scores']);
    expect(c.raw, 'no company or tenant named anywhere in the request').not.toMatch(/tenant|company/i);
    await expect(dangerOf(s)).toContainText(FW.saveFail);
    await expect(s).toBeVisible();
    const text = await page.locator('body').innerText();
    for (const never of ['Bongani', 'Mthembu', 'Fleet controller', 'Sipho Ndlovu', 'Thabo Khumalo', 'Lerato Mokoena']) expect(text, `nothing of A: "${never}"`).not.toContain(never);
    expect(voter!.votes.size).toBe(0);
    expect(a.panel.map((e) => e.feedback), 'A\'s interview is unchanged').toEqual(['WAITING', 'GIVEN', 'WAITING', 'WAITING']);
  });
});

// ================================================================ AC-2.8 Company B, after an in-app sign-out
test.describe('AC-2.8 Company B after a sign-out', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2.8 A\'s Recruiter signs out with the sheet filled and the vote held; B\'s Recruiter signs in on the page the app left (no reload) and opens B\'s sheet: nothing of A (person, names, notes, scores) shows at any moment, also when A\'s held answer arrives late; B\'s vote goes with B\'s sign-in only', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    voter!.snapshot('iv-b', SNAP2);
    sched!.set(B_CAND, [capIv('iv-b', { panel: [person('Lindiwe Peters', 'WAITING', { person_id: 'sub-b-lindiwe' })] })], { done: 0, total: 2 });
    await onTab(fx, [capIv()], 'iv-cap');
    const s = await openSheet(page);
    await fillSheet(s, { ...FILL, notes: 'A-only feedback note' });
    voter!.refuse({ hold: true });
    await submitOf(s).click();
    await expect.poll(() => voter!.heldCount).toBe(1);
    if (isPhone()) await page.evaluate(() => window.scrollTo(0, 0));
    await avatarButton(page).dispatchEvent('click');
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).dispatchEvent('click');
    await expect(page).toHaveURL(/\/sign-in/);
    const aWords = ['A-only feedback note', 'Thabo Khumalo', 'Sipho Ndlovu', 'Bongani', 'Forklift safety', 'Fleet controller'];
    await page.evaluate((words) => {
      const seen: string[] = [];
      (window as unknown as { __seenA: string[] }).__seenA = seen;
      const check = () => {
        const all = `${document.documentElement.outerHTML} ${[...document.querySelectorAll('input, textarea, select')].map((x) => (x as HTMLInputElement).value).join(' ')}`;
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
    await inApp(page, `/hire/candidates/${B_CAND}?tab=interviews&interview=iv-b`);
    await interviewsDrawn(page);
    const b = await openSheet(page, FW.title('Mandla', 'Cele'));
    voter!.release();
    await quiet(page);
    await page.waitForTimeout(500);
    await expect(b, 'A\'s late answer closes nothing of B').toBeVisible();
    expect(await heldIn(b), 'B\'s sheet starts empty').toEqual({ person: '', values: expect.any(Array) as unknown as string[], decision: null, notes: '' });
    expect((await pickerChoices(b)).choices).toEqual(['Lindiwe Peters']);
    await fillSheet(b, { person: 'Lindiwe Peters', scores: [4, 4], decision: 'Yes', criteria: SNAP2 });
    await press(b);
    const last = voter!.posts.at(-1)!;
    expect([last.email, last.path, last.status], 'B\'s own vote, with B\'s sign-in').toEqual([who.email, '/v1/interviews/iv-b/votes', 201]);
    expect(bodyOf(last)['on_behalf_of']).toBe('sub-b-lindiwe');
    expect(await seenA(), 'nothing of A at any moment').toEqual([]);
  });
});

// ================================================================ AC-2.9 Words
test.describe('AC-2.9 Words', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2.9 Every word in the sheet, as it opens, filled and after each kind of refusal, is from the kit, the parent spec, W-9b, D-RUI-03.6 or D-RUI-03.12; no "Masked", "average", "Passed", "out of 10"', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv()], 'iv-cap');
    const s = await openSheet(page);
    const allowed = new Set<string>([
      TITLE, LINE, FW.from, 'Sipho Ndlovu', 'Thabo Khumalo', ...SNAP.map((c) => c.label), ...SCALE, FW.decision, ...DECISIONS.flatMap((d) => [d.label, d.help]),
      FW.notes, FW.optional, `${FW.notes} ${FW.optional}`, FW.cancel, FW.submit, FW.notStarted, FW.saveFail, FW.close,
    ]);
    const check = async (when: string) => {
      const words = await wordsOf(s);
      expect(words.filter((w) => !allowed.has(w)), `${when}: words not from the kit, the spec or the decisions`).toEqual([]);
      expect(words.join('\n')).not.toMatch(NEVER_WORDS);
    };
    await check('as it opens');
    await fillSheet(s, { ...FILL, notes: 'Words check note' });
    await check('filled');
    voter!.refuse({ status: 409, body: { error: 'Conflict', code: 'NOT_STARTED' } });
    await press(s);
    await expect(dangerOf(s)).toContainText(FW.notStarted);
    await check('after NOT_STARTED');
    voter!.refuse({ status: 500 });
    await press(s);
    await expect(dangerOf(s)).toContainText(FW.saveFail);
    await check('after a failure');
  });
});

// ================================================================ AC-2.10 Kit match
test.describe('AC-2.10 Kit match', () => {
  test.beforeEach(noBackendOnly);

  const DS = join(__dirname, '..', '..', 'src', 'styles', 'design-system');
  const known = (): Set<string> => new Set(['components.css', 'tokens/base.css'].flatMap((f) => readFileSync(join(DS, f), 'utf8').match(/\.pp-[a-z0-9_-]+/g) ?? []).map((c: string) => c.slice(1)));
  /** The kit's layout helpers may differ, `--inline` is the kit's preview switch, and the footer note is the decider line D-RUI-03.17 hides. */
  const notJudged = [/^pp-gap-/, /^pp-inline/, /^pp-stack/, /^pp-grid/, /^pp-text(--|$)/, /--inline$/, /^pp-drawer__footer-note$/, /^pp-app-shell__content$/];

  test('AC-2.10 The app is synced to the design system ref the sheet structure was captured at', async () => {
    desktopOnly('one check of a file');
    const sync = JSON.parse(readFileSync(join(DS, 'sync.json'), 'utf8')) as { ref: string };
    expect(sync.ref, 'a design system change needs the structure captured again (a child lock)').toBe(KIT_CAPTURE.ref);
  });

  test('AC-2.10 The sheet matches the kit\'s "Interview feedback" drawer (1280) and "Interview feedback (phone)" page (390): every kit class in place but the picker field above the sliders allowed; the title, line, sliders, tiles, Notes and buttons in the kit\'s parts; only design system classes and no style that sets a look', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter };
    await onTab(fx, [capIv()], 'iv-cap');
    const s = await openSheet(page);
    const name = isPhone() ? 'Interview feedback (phone)' : 'Interview feedback';
    const kit = (KIT_CAPTURE.screens as Record<string, { classes: readonly string[] }>)[name]!.classes;
    const have = new Set(await s.evaluate((root) => [...new Set([root, ...root.querySelectorAll('*')].flatMap((el) => [...el.classList]).filter((c) => c.startsWith('pp-')))]));
    expect(kit.filter((c) => !have.has(c) && !notJudged.some((re) => re.test(c))), `${name}: kit classes the sheet lacks`).toEqual([]);
    if (isPhone()) {
      await expect(s.locator('.pp-page-header__title')).toHaveText(TITLE);
      await expect(s.locator('.pp-page-header__description')).toHaveText(LINE);
    } else {
      await expect(s.locator('.pp-drawer__title')).toHaveText(TITLE);
      await expect(s.locator('.pp-drawer__description')).toHaveText(LINE);
      await expect(s.locator('.pp-drawer__footer').getByRole('button', { name: FW.submit, exact: true })).toBeVisible();
      await expect(s.locator('.pp-drawer__footer').getByRole('button', { name: FW.cancel, exact: true })).toBeVisible();
    }
    await expect(s.locator('.pp-slider')).toHaveCount(SNAP.length);
    await expect(s.locator('.pp-radio--tile')).toHaveCount(4);
    await expect(s.locator('textarea.pp-textarea')).toHaveCount(1);
    await expect(submitOf(s)).toHaveClass(/\bpp-button--primary\b/);
    await expect(cancelOf(s)).toHaveClass(/\bpp-button--default\b/);
    const ds = known();
    const found = await s.evaluate((root) => ({
      classes: [...new Set([root, ...root.querySelectorAll('*')].flatMap((e) => [...e.classList]).filter((c) => c.startsWith('pp-')))],
      // Angular's own form state classes (ng-*) and the classes the design system's icons carry (lucide*) are not the app's; anything else that is not pp-* is.
      other: [...new Set([root, ...root.querySelectorAll('*')].flatMap((e) => [...e.classList]).filter((c) => !c.startsWith('pp-') && !/^(ng-|lucide)/.test(c)))],
      styled: [...root.querySelectorAll('[style]')].filter((e) => !/^(--[\w-]+:[^;]*;?\s*)+$/.test(e.getAttribute('style') ?? '')).map((e) => e.tagName.toLowerCase()),
      styles: root.querySelectorAll('style').length,
    }));
    expect(found.classes.filter((c) => !ds.has(c)), 'every pp-* class exists in the design system').toEqual([]);
    expect(found.other, 'only design system classes').toEqual([]);
    expect(found.styled, 'no style attribute that sets a look').toEqual([]);
    expect(found.styles, 'no style element').toBe(0);
  });
});

// ================================================================ AC-2.11 pepla-dev
test.describe('AC-2.11 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-2.11 runs on pepla-dev only.');
  // The dev step runs every @pepla-dev test once per width and seeds once, so each width has its own candidate and interview.
  type DevIds = { candidate: string; firstName: string; lastName: string; interview: string };
  const ALL = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-ui-03', 'dev-ids-capture.json'), 'utf8')) as Record<string, DevIds>;
  const devOf = (): DevIds => { const d = ALL[test.info().project.name]; if (!d) throw new Error(`dev-ids-capture.json has no entry for ${test.info().project.name}`); return d; };

  test('AC-2.11 @pepla-dev The company A HR login opens its width\'s seeded candidate, presses "Capture feedback" on the started interview, picks the waiting person, scores, decides and submits; the line then reads "Captured by {HR name} for {first name}" with the rating; the real POST with its Idempotency-Key passed the browser\'s preflight from the dev site', async ({ page, signIn, hr }) => {
    const DEV = devOf();
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto(`/hire/candidates/${DEV.candidate}?tab=interviews&interview=${DEV.interview}`);
    await expect(personHeader(page)).toBeVisible();
    await interviewsDrawn(page);
    await expect(main(page).getByText(IW.failed, { exact: true })).toHaveCount(0);
    const s = await openSheet(page, FW.title(DEV.firstName, DEV.lastName));
    const { choices } = await pickerChoices(s);
    expect(choices, 'the one seeded waiting person (the dev panel login)').toHaveLength(1);
    const who = choices[0]!;
    await pickPerson(s, who);
    const labels = (await sliderTexts(s)).map((x) => x.label);
    expect(labels.length, 'the seeded snapshot').toBeGreaterThan(0);
    for (const l of labels) await setScore(s, l, 4);
    await decide(s, 'Yes');
    const posted = page.waitForResponse((r) => r.request().method() === 'POST' && /\/v1\/interviews\/[^/]+\/votes$/.test(new URL(r.url()).pathname), { timeout: 20_000 });
    await submitOf(s).click();
    const res = await posted;
    expect(res.status(), `the vote is saved (${await res.text().catch(() => '')})`).toBe(201);
    expect(res.request().headers()['idempotency-key'], 'sent with its Idempotency-Key').toBeTruthy();
    // A cross-origin POST with that header reached the API, so the browser's preflight passed; check the preflight itself too.
    const origin = new URL(page.url()).origin;
    const pre = await page.request.fetch(res.url(), { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key' } });
    expect([200, 204], 'the preflight passes').toContain(pre.status());
    expect((pre.headers()['access-control-allow-headers'] ?? '').toLowerCase()).toContain('idempotency-key');
    await sheetGone(page, FW.title(DEV.firstName, DEV.lastName));
    const first = who.split(' ')[0]!;
    await expect.poll(async () => (await readChosen(page)).people.find((p) => p.text.includes(who))?.text ?? '', { timeout: 15_000 }).toMatch(new RegExp(`Captured by \\S.* for ${first}`));
    const line = (await readChosen(page)).people.find((p) => p.text.includes(who))!.text;
    expect(line).toContain('Yes · 4 out of 5');
    expect(line).not.toMatch(BAD_WORDS);
    test.info().annotations.push({ type: 'record', description: page.url() });
  });
});
