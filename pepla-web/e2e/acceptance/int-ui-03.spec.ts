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
import { personHeader, type RecordFake } from './support/rec-ui-02/record';
import type { EventsFake } from './support/rec-ui-02/notes';
import { IW, LIST, canOf, guest, inApp, interviewsDrawn, iv, person, readChosen, readRows, rowsOf, voted, type Can, type InterviewsFake, type Iv } from './support/int-ui/interviews';
import { SW, bookedIv, wordsIn, type ScheduleFake } from './support/int-ui/schedule';
import {
  ACTIONS, ACTION_WORDS, CW, FOOTER, REASONS, actionButton, actionsShown, allowedWords, anyDialog, canKey, closeButtonOf, dangerOf, dialogOf, dnhLine,
  expect, footerOf, isOff, isPhone, lineOf, main, mainButtonOf, menuItems, menuName, menuOf, moreActions, noteOf, openAction, openerOf, reasonOf, reasonsIn, secondaryOf, test,
  titleOf, type Action, type CloseFake,
} from './support/int-ui/close';

/**
 * INT-UI-03 · Cancel, did not happen, mark as done: on a candidate's Interviews tab a Recruiter cancels a booked interview before it
 * starts, records that it did not happen after the start, or marks it as done with feedback missing, each with a reason, from More
 * actions on the chosen interview (plain buttons on a phone). Jira NH-272 (epic NH-223, amber). Lock acceptance-lock/int-ui-03 (one
 * squashed commit on the child lock acceptance-lock/int-ui-02.1; the builder also merges child lock acceptance-lock/int-ui-01.2).
 * Spec: specs/interview-journey/cards/INT-UI-03.md, section "Changes after spec check round 1 (27 Nov)" (M-1, M-2, S-1 to S-7, final
 * AC-1 to AC-10, decisions INT-UI-03-D1 to D15), its check INT-UI-03-spec-check-r2.md (leftovers L-1 to L-5). The fakes answer as the
 * merged server does (support/int-ui/close.ts). Where the spec is silent, cards/int-ui-03.md says what these tests take (T-C1 up).
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg (08:00 UTC), a Thursday.
 * AC-10 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 */

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');
const desktopOnly = (why: string) => test.skip(test.info().project.name !== 'desktop-1280', `Desktop only: ${why}`);

type Fx = {
  page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null; record: RecordFake | null;
  events: EventsFake | null; interviews: InterviewsFake | null; sched: ScheduleFake | null; closer: CloseFake | null;
};

const BONGANI = 'cand-bongani';
const TENDAI = 'cand-tendai';
const PULE = 'cand-w3';
const B_CAND = 'cand-b2';
/** A time on a November 2026 day, given in Johannesburg hours. */
const sast = (day: number, hh: number, mm = 0) => iso(Date.UTC(2026, 10, day, hh - 2, mm));
const BAD_WORDS = /\b(null|undefined|NaN)\b|Invalid Date|\[object Object\]|⟦|\b(CANDIDATE_ASKED|PANEL_NOT_AVAILABLE|CANDIDATE_WITHDREW|CANDIDATE_DID_NOT_COME|INTERVIEWER_DID_NOT_COME|FEEDBACK_GIVEN_ANOTHER_WAY|PANEL_MEMBER_CANNOT_GIVE_FEEDBACK|OTHER|NOT_CANCELLABLE|NOT_ALLOWED_NOW|KEY_REUSED|KEY_IN_USE|INVALID_FIELD)\b/;
const SIPHO = () => person('Sipho Ndlovu', 'WAITING', { person_id: 'sub-a-sipho', due_at: sast(21, 8) });

/** Booked, five days ahead: cancel only (and reschedule). */
const futureIv = (id = 'iv-f', extra: Partial<Iv> = {}): Iv => bookedIv(id, sast(24, 10), { type: 'CULTURE_FIT', can: canOf({ reschedule: true, cancel: true }), panel: [SIPHO()], ...extra });
/** Started two hours ago, nobody has given feedback: did not happen and mark as done. */
const startedIv = (id = 'iv-s', extra: Partial<Iv> = {}): Iv => iv(id, sast(19, 8), 'SCHEDULED', {
  type: 'PHONE_SCREEN', sequence: 1, can: canOf({ did_not_happen: true, mark_done: true }), panel: [SIPHO()], ...extra,
});
/** Started yesterday, one person has given feedback: mark as done only. */
const someFeedbackIv = (id = 'iv-g', extra: Partial<Iv> = {}): Iv => iv(id, sast(18, 9), 'SCHEDULED', {
  type: 'TECHNICAL', sequence: 1, can: canOf({ mark_done: true, capture_feedback: true }),
  panel: [voted('Lerato Mokoena', 'YES', 4, null, { person_id: 'sub-a-lerato' }), SIPHO()], ...extra,
});
const typeOf = (a: Action) => (a === 'cancel' ? 'CULTURE_FIT' : 'PHONE_SCREEN');
const ivFor = (a: Action, extra: Partial<Iv> = {}) => (a === 'cancel' ? futureIv('iv-f', extra) : startedIv('iv-s', extra));

async function asRecruiter(fx: Fx, who: Who = WHO.recruiterA): Promise<void> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
}
/** Opens a record at an address with a query, and waits for the header (or the not-found or failure line). */
async function openAt(page: Page, id: string, query = ''): Promise<void> {
  await page.goto(`/hire/candidates/${id}${query}`);
  await expect(personHeader(page).or(main(page).getByText(IW.notFound, { exact: true })).or(main(page).getByText('This candidate could not be loaded.', { exact: true })).first()).toBeVisible();
}
/** Signs in as A's Recruiter and opens Bongani's Interviews tab with these interviews, the given one chosen. */
async function onTab(fx: Fx, list: Iv[], chosen?: string): Promise<void> {
  fx.sched!.set(BONGANI, list, { done: 1, total: 3 });
  await asRecruiter(fx);
  await openAt(fx.page, BONGANI, `?tab=interviews${chosen ? `&interview=${chosen}` : ''}`);
  await interviewsDrawn(fx.page);
  if (chosen) await expect.poll(async () => (await readRows(fx.page)).findIndex((r) => r.selected)).toBe(list.findIndex((x) => x.id === chosen));
}
async function chooseRow(page: Page, n: number): Promise<void> {
  await rowsOf(page).nth(n).click();
  await expect.poll(async () => (await readRows(page)).findIndex((r) => r.selected), { message: `row ${n} is chosen` }).toBe(n);
}
const chosenIndex = async (page: Page) => (await readRows(page)).findIndex((r) => r.selected);
/** Every control in `main` by what it says (text or label). */
async function controls(page: Page): Promise<string[]> {
  return main(page).evaluate((m) => [...m.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="link"]')]
    .map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`.replace(/\s+/g, ' ').trim()));
}
/** None of this card's controls, no menu button and no menu in the page. */
async function noCloseActions(page: Page, where: string): Promise<void> {
  const found = (await controls(page)).filter((c) => [CW.cancel, CW.markDone].some((w) => c.includes(w)) || /More actions/i.test(c));
  expect(found, `${where}: no close action`).toEqual([]);
  await expect(main(page).getByRole('button', { name: /Did not happen/ }), `${where}: "Did not happen" is no button`).toHaveCount(0);
  await expect(page.locator('.pp-dropdown-menu, [role="menu"]'), `${where}: no menu`).toHaveCount(0);
}
/** "Capture feedback" and "Add panel member" are later cards'. */
async function noLaterActions(page: Page, where: string): Promise<void> {
  expect((await controls(page)).filter((c) => /Capture feedback|Add panel member/.test(c)), where).toEqual([]);
}
/** Chooses a reason by its words and waits until it is checked. */
async function choose(d: Locator, words: string): Promise<void> {
  await reasonOf(d, words).check();
  await expect(reasonOf(d, words)).toBeChecked();
}
async function press(d: Locator, a: Action): Promise<void> {
  await mainButtonOf(d, a).click();
  await quiet(d.page());
}
const bodyOf = (c: { body: unknown }) => c.body as Record<string, unknown>;

// ================================================================ AC-1 Which actions show
test.describe('AC-1 Which actions show', () => {
  test.beforeEach(noBackendOnly);

  test('AC-1 For every `can` mix on the chosen booked interview (all false, all true, each of the three alone, cancel with reschedule, did_not_happen with mark_done) each of "Cancel interview", "Did not happen", "Mark as done" shows exactly when its flag is true, in that order; More actions (desktop) exactly when one does; buttons and no menu on a phone, a menu and no such buttons at 1280; an interview not chosen shows none; "Capture feedback" and "Add panel member" show nowhere', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    const errors = watchErrors(page);
    const mixes: Array<Partial<Can> | 'all' | 'none'> = ['none', 'all', { cancel: true }, { did_not_happen: true }, { mark_done: true }, { cancel: true, reschedule: true }, { did_not_happen: true, mark_done: true }];
    const list = mixes.map((m, i) => iv(`iv-m${i}`, sast(20 + i, 10), 'SCHEDULED', { type: i % 2 ? 'TECHNICAL' : 'CULTURE_FIT', can: canOf(m), panel: [SIPHO()] }));
    await onTab(fx, list);
    for (let i = 0; i < list.length; i++) {
      await chooseRow(page, i);
      const can = list[i]!.can;
      const want = ACTIONS.filter((a) => can[canKey(a)]).map((a) => ACTION_WORDS[a]);
      const where = `${list[i]!.id} ${JSON.stringify(can)}`;
      if (isPhone()) {
        await expect(main(page).getByRole('button', { name: /More actions/ }), `${where}: no menu button on a phone`).toHaveCount(0);
        await expect(page.locator('[role="menu"], .pp-dropdown-menu'), `${where}: no menu on a phone`).toHaveCount(0);
        expect(await actionsShown(page), where).toEqual(want);
        for (const a of ACTIONS) await expect(actionButton(page, a), `${where}: ${a}`).toHaveCount(can[canKey(a)] ? 1 : 0);
      } else {
        await expect(moreActions(page), `${where}: More actions exactly when one action shows`).toHaveCount(want.length ? 1 : 0);
        if (want.length) {
          await expect(moreActions(page)).toHaveAccessibleName(menuName(list[i]!.type!));
          expect(await menuItems(page), where).toEqual(want);
        }
        for (const a of ACTIONS) await expect(actionButton(page, a), `${where}: no plain "${ACTION_WORDS[a]}" button at 1280`).toHaveCount(0);
      }
      // Only on the chosen interview: nothing in the list rows.
      expect((await main(page).locator(LIST).evaluate((l) => [...l.querySelectorAll('button, [role="menuitem"]')].map((b) => `${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`.trim())))
        .filter((t) => /More actions|Cancel interview|Did not happen|Mark as done/.test(t)), `${where}: none in the list`).toEqual([]);
      await noLaterActions(page, where);
    }
    expect(errors, 'no console error').toEqual([]);
  });

  test('AC-1 Nothing shows on a closed interview, also with every `can` true (COMPLETED, CANCELLED, DID_NOT_HAPPEN), on an interview with no type words, while the tab loads, on a failed read, or in the empty state', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    const list = [
      iv('iv-c1', sast(10, 9), 'COMPLETED', { type: 'PHONE_SCREEN', can: canOf('all'), panel: [voted('Sipho Ndlovu', 'YES', 4)] }),
      iv('iv-c2', sast(11, 9), 'CANCELLED', { type: 'TECHNICAL', closed_reason: 'CANDIDATE_ASKED', can: canOf('all'), panel: [SIPHO()] }),
      iv('iv-c3', sast(12, 9), 'DID_NOT_HAPPEN', { type: 'FINAL', closed_reason: 'OTHER', closed_note: 'Power cut', can: canOf('all'), panel: [SIPHO()] }),
      iv('iv-c4', sast(25, 9), 'SCHEDULED', { type: null, can: canOf('all'), panel: [SIPHO()] }),
    ];
    sched!.set(BONGANI, list, { done: 1, total: 3 });
    await asRecruiter(fx);
    interviews!.refuse({ hold: true, id: BONGANI });
    await openAt(page, BONGANI, '?tab=interviews&interview=iv-c4');
    await expect.poll(() => interviews!.heldCount).toBe(1);
    await page.waitForTimeout(300);
    await noCloseActions(page, 'while the tab loads');
    interviews!.release();
    await interviewsDrawn(page);
    for (let i = 0; i < list.length; i++) {
      await chooseRow(page, i);
      await noCloseActions(page, `${list[i]!.id} (${list[i]!.status}, type ${list[i]!.type})`);
    }
    // The empty state and a failed read.
    sched!.set(TENDAI, []);
    await openAt(page, TENDAI, '?tab=interviews');
    await expect(main(page).getByText(IW.empty, { exact: true })).toBeVisible();
    await noCloseActions(page, 'the empty state');
    interviews!.refuse({ status: 500, id: PULE });
    await openAt(page, PULE, '?tab=interviews');
    await expect(main(page).getByText(IW.failed, { exact: true })).toBeVisible();
    await quiet(page);
    await noCloseActions(page, 'a failed read');
    expect(closer!.writes).toHaveLength(0);
  });
});

// ================================================================ AC-2 Dialog content
test.describe('AC-2 Dialog content', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2 Cancel: title "Cancel the culture fit interview?", no line without a guest, only "The guest\'s link stops working." with a guest (never the first sentence), legend "Reason", the four reasons in order with nothing chosen, no "Describe the reason" until "Other", footer "Keep interview" then "Cancel interview"', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [futureIv('iv-f'), futureIv('iv-fg', { type: 'FINAL', at: sast(26, 10), panel: [SIPHO(), guest('Naledi Guest', 'WAITING', { email: 'naledi@example.org' })] })], 'iv-f');
    for (const [row, key, line] of [[0, 'CULTURE_FIT', ''], [1, 'FINAL', CW.cancelGuest]] as const) {
      await chooseRow(page, row);
      const d = await openAction(page, 'cancel', key);
      await expect(d.getByRole('heading', { name: titleOf('cancel', key), exact: true })).toBeVisible();
      expect(titleOf('cancel', key)).toMatch(/^Cancel the (culture fit|final) interview\?$/);
      expect(await lineOf(d), `${key}: the line`).toBe(line);
      expect(await d.innerText()).not.toContain(CW.cancelFirst);
      expect(await d.innerText()).not.toContain('Everyone invited');
      await expect(d.getByRole('group', { name: CW.reason, exact: true })).toBeVisible();
      expect(await reasonsIn(d)).toEqual(REASONS.cancel.map(([, w]) => ({ name: w, checked: false })));
      await expect(noteOf(d), 'no "Describe the reason" until Other').toHaveCount(0);
      expect((await footerOf(d).getByRole('button').allInnerTexts()).map((t) => t.trim())).toEqual(FOOTER.cancel);
      await expect(closeButtonOf(d)).toBeVisible();
      await secondaryOf(d, 'cancel').click();
      await expect(d).toBeHidden();
    }
  });

  test('AC-2 Did not happen: title "Record that the phone screen interview did not happen", the line "Nobody is emailed. You can book a phone screen interview again afterwards." always, the three reasons in order, footer "Cancel" then "Save"', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [startedIv('iv-s', { panel: [SIPHO(), guest(null, 'WAITING')] }), startedIv('iv-s2', { type: 'CULTURE_FIT', at: sast(19, 7) })], 'iv-s');
    for (const [row, key] of [[0, 'PHONE_SCREEN'], [1, 'CULTURE_FIT']] as const) {
      await chooseRow(page, row);
      const d = await openAction(page, 'did_not_happen', key);
      expect(await lineOf(d)).toBe(dnhLine(key));
      expect(dnhLine(key)).toMatch(/book a (phone screen|culture fit) interview/);
      expect(await reasonsIn(d)).toEqual(REASONS.did_not_happen.map(([, w]) => ({ name: w, checked: false })));
      expect((await footerOf(d).getByRole('button').allInnerTexts()).map((t) => t.trim())).toEqual(FOOTER.did_not_happen);
      await expect(noteOf(d)).toHaveCount(0);
      await secondaryOf(d, 'did_not_happen').click();
      await expect(d).toBeHidden();
    }
  });

  test('AC-2 Mark as done: the approved line with the guest clause only while the guest\'s feedback is waiting; W-N2 with no guest and with a guest who gave feedback; three reasons, footer "Cancel" then "Mark as done"', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    const doneOnly = canOf({ mark_done: true });
    await onTab(fx, [
      startedIv('iv-n', { at: sast(19, 6), can: doneOnly }),
      startedIv('iv-w', { type: 'TECHNICAL', at: sast(19, 7), can: doneOnly, panel: [SIPHO(), guest('Naledi Guest', 'WAITING')] }),
      startedIv('iv-g', { type: 'FINAL', at: sast(19, 8), can: doneOnly, panel: [SIPHO(), guest('Naledi Guest', 'GIVEN', { vote: { rating: 'YES', overall: 4, on_behalf_by_name: null } })] }),
    ], 'iv-n');
    for (const [row, key, line] of [[0, 'PHONE_SCREEN', CW.doneNoGuest], [1, 'TECHNICAL', CW.doneGuest], [2, 'FINAL', CW.doneNoGuest]] as const) {
      await chooseRow(page, row);
      const d = await openAction(page, 'complete', key);
      expect(await lineOf(d), `${key}`).toBe(line);
      expect(await reasonsIn(d)).toEqual(REASONS.complete.map(([, w]) => ({ name: w, checked: false })));
      expect((await footerOf(d).getByRole('button').allInnerTexts()).map((t) => t.trim())).toEqual(FOOTER.complete);
      await choose(d, CW.other);
      await expect(noteOf(d), '"Describe the reason" while Other is chosen').toBeVisible();
      await expect(d.getByText(CW.describe, { exact: true }), 'a visible label').toBeVisible();
      await choose(d, REASONS.complete[0]![1]);
      await expect(noteOf(d), 'hidden again for another reason').toHaveCount(0);
      await secondaryOf(d, 'complete').click();
      await expect(d).toBeHidden();
    }
  });
});

// ================================================================ AC-3 Main button
test.describe('AC-3 Main button', () => {
  test.beforeEach(noBackendOnly);

  for (const a of ACTIONS) {
    test(`AC-3 ${ACTION_WORDS[a]}: the main button is off with nothing chosen, on after a reason that is not Other; with Other off until the trimmed text has a character, off for spaces only; the field takes at most 500 characters; typed text survives switching away from Other and back`, async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
      await onTab(fx, [ivFor(a)], ivFor(a).id);
      const d = await openAction(page, a, typeOf(a));
      const btn = mainButtonOf(d, a);
      expect(await isOff(btn), 'off with nothing chosen').toBe(true);
      await choose(d, REASONS[a][0]![1]);
      await expect.poll(() => isOff(btn), 'on after a reason').toBe(false);
      await choose(d, CW.other);
      await expect.poll(() => isOff(btn), 'Other with no text: off').toBe(true);
      await noteOf(d).fill('   ');
      await expect.poll(() => isOff(btn), 'spaces only: off').toBe(true);
      await noteOf(d).fill(' x ');
      await expect.poll(() => isOff(btn), 'one character once trimmed: on').toBe(false);
      await noteOf(d).fill('');
      await noteOf(d).pressSequentially('y'.repeat(510), { delay: 0 });
      expect((await noteOf(d).inputValue()).length, 'at most 500 characters').toBe(500);
      await expect(noteOf(d)).toHaveAttribute('maxlength', '500');
      await noteOf(d).fill('Kept text');
      await choose(d, REASONS[a][1]![1]);
      await expect(noteOf(d)).toHaveCount(0);
      await choose(d, CW.other);
      await expect(noteOf(d), 'the typed text comes back').toHaveValue('Kept text');
      await expect.poll(() => isOff(btn)).toBe(false);
      expect(closer!.writes, 'nothing sent').toHaveLength(0);
    });
  }
});

// ================================================================ AC-4 Request
test.describe('AC-4 Request', () => {
  test.beforeEach(noBackendOnly);

  test('AC-4 Each action and each reason sends exactly one PATCH to /v1/candidates/{id}/interviews/{interviewId} with exactly { action, reason } (Mark as done sends `complete`), one Idempotency-Key, no company anywhere; with Other the trimmed `reason_note`, and never a note after switching away from Other', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    const sent: Array<Record<string, unknown>> = [];
    let first = true;
    for (const a of ACTIONS) {
      for (const [code, words] of REASONS[a]) {
        const x = ivFor(a);
        if (first) { await onTab(fx, [x], x.id); first = false; } else { sched!.set(BONGANI, [x], { done: 1, total: 3 }); await openAt(page, BONGANI, `?tab=interviews&interview=${x.id}`); await interviewsDrawn(page); }
        const before = closer!.writes.length;
        const d = await openAction(page, a, typeOf(a));
        if (code === 'OTHER') {
          await choose(d, words);
          await noteOf(d).fill('   Rescheduled by phone  ');
        } else {
          // Type a note under Other first, then switch away: the note must not be sent.
          await choose(d, CW.other);
          await noteOf(d).fill('Not to be sent');
          await choose(d, words);
        }
        await press(d, a);
        await expect(d).toBeHidden();
        expect(closer!.writes.length - before, `${a} ${code}: one request`).toBe(1);
        const c = closer!.writes.at(-1)!;
        expect(c.path).toBe(`/v1/candidates/${BONGANI}/interviews/${x.id}`);
        expect(c.status).toBe(200);
        const action = a;
        expect(bodyOf(c), `${a} ${code}`).toEqual(code === 'OTHER' ? { action, reason: code, reason_note: 'Rescheduled by phone' } : { action, reason: code });
        expect(c.idempotencyKey, 'one Idempotency-Key').toMatch(/^.{1,200}$/);
        expect(c.raw.match(/"idempotency-key"/gi) ?? [], 'exactly one key header').toHaveLength(1);
        expect(Object.keys(c.query), 'no query').toEqual([]);
        expect(companyIdIn(c), `${a} ${code}: no company`).toEqual([]);
        sent.push(bodyOf(c));
      }
    }
    const keys = closer!.writes.map((c) => c.idempotencyKey);
    expect(new Set(keys).size, 'a new key for each opening').toBe(keys.length);
    expect(sent).toHaveLength(10);
  });

  test('AC-4 A double click sends one request; a retry after a failed save with nothing changed reuses the key; a retry after a change uses a new key; a new opening uses a new key', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [startedIv('iv-s')], 'iv-s');
    // Double click, with the answer held so the first request is still running.
    let d = await openAction(page, 'complete', 'PHONE_SCREEN');
    await choose(d, REASONS.complete[0]![1]);
    closer!.refuse({ hold: true, status: 500 });
    await mainButtonOf(d, 'complete').dblclick();
    await expect.poll(() => closer!.heldCount).toBe(1);
    await page.waitForTimeout(400);
    expect(closer!.writes, 'a double click: one request').toHaveLength(1);
    closer!.release();
    await expect(dangerOf(d).getByText(CW.saveFail, { exact: true })).toBeVisible();
    expect(closer!.writes, 'still one request').toHaveLength(1);
    const k1 = closer!.writes[0]!.idempotencyKey;
    // Unchanged retry: same key.
    closer!.refuse({ status: 500 });
    await press(d, 'complete');
    await expect(dangerOf(d).getByText(CW.saveFail, { exact: true })).toBeVisible();
    expect(closer!.writes[1]!.idempotencyKey, 'unchanged retry: the same key').toBe(k1);
    expect(bodyOf(closer!.writes[1]!)).toEqual(bodyOf(closer!.writes[0]!));
    // A change, then a retry: a new key.
    await choose(d, REASONS.complete[1]![1]);
    closer!.refuse({ status: 500 });
    await press(d, 'complete');
    await expect(dangerOf(d).getByText(CW.saveFail, { exact: true })).toBeVisible();
    const k3 = closer!.writes[2]!.idempotencyKey;
    expect(k3, 'a changed body: a new key').not.toBe(k1);
    // Back to the first reason: the body changed again, so another new key (the old key with the old body would be safe too, but the
    // spec says any change to the body makes a new key).
    await choose(d, CW.other);
    await noteOf(d).fill('By phone');
    await press(d, 'complete');
    await expect(d).toBeHidden();
    const k4 = closer!.writes[3]!.idempotencyKey;
    expect([k4 === k1, k4 === k3], 'another change: another new key').toEqual([false, false]);
    expect(closer!.writes[3]!.status).toBe(200);
    // A new opening on another interview: a new key.
    sched!.set(BONGANI, [startedIv('iv-s2')], { done: 1, total: 3 });
    await openAt(page, BONGANI, '?tab=interviews&interview=iv-s2');
    await interviewsDrawn(page);
    d = await openAction(page, 'did_not_happen', 'PHONE_SCREEN');
    await choose(d, REASONS.did_not_happen[0]![1]);
    await press(d, 'did_not_happen');
    await expect(d).toBeHidden();
    expect(new Set(closer!.writes.map((c) => c.idempotencyKey)).size).toBe(4);
  });

  test('AC-4 Closing and opening the dialog again makes a new key; the choice and text live in the dialog only: nothing in the address, local or session storage', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [futureIv('iv-f')], 'iv-f');
    let d = await openAction(page, 'cancel', 'CULTURE_FIT');
    await choose(d, CW.other);
    await noteOf(d).fill('MARK-typed-reason');
    closer!.refuse({ status: 500 });
    await press(d, 'cancel');
    await expect(dangerOf(d)).toBeVisible();
    const store = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
    expect(store).not.toContain('MARK-typed-reason');
    expect(store).not.toContain('OTHER');
    expect(new URL(page.url()).search, 'the address keeps tab and interview only').toBe('?tab=interviews&interview=iv-f');
    await secondaryOf(d, 'cancel').click();
    await expect(d).toBeHidden();
    d = await openAction(page, 'cancel', 'CULTURE_FIT');
    await choose(d, REASONS.cancel[0]![1]);
    await press(d, 'cancel');
    await expect(d).toBeHidden();
    expect(closer!.writes).toHaveLength(2);
    expect(closer!.writes[1]!.idempotencyKey, 'a new opening: a new key').not.toBe(closer!.writes[0]!.idempotencyKey);
  });
});

// ================================================================ AC-5 Answers
test.describe('AC-5 Answers', () => {
  test.beforeEach(noBackendOnly);

  for (const a of ACTIONS) {
    test(`AC-5 ${ACTION_WORDS[a]} 200: the dialog closes, the tab reads the interviews once more, the same interview stays chosen and named in the address with its new status and reason words, focus is on its row, no toast${a === 'complete' ? '; the waiting line shows "No feedback"' : '; "Schedule an interview, {type}" shows on it'}`, async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
      const x = ivFor(a);
      // A done interview before it and another one after it, so a page that chooses the first row or "the newest open one" after the save is caught.
      const before = iv('iv-before', sast(12, 9), 'COMPLETED', { type: 'TECHNICAL', can: canOf({}), panel: [voted('Sipho Ndlovu', 'YES', 4)] });
      await onTab(fx, [before, x, futureIv('iv-later', { type: 'FINAL', at: sast(28, 10) })], x.id);
      const at = await chosenIndex(page);
      expect(at, 'the interview to save is not the first row').toBeGreaterThan(0);
      const reads = interviews!.reads(BONGANI).length;
      const d = await openAction(page, a, typeOf(a));
      await choose(d, REASONS[a][0]![1]);
      await press(d, a);
      await expect(d).toBeHidden();
      await expect.poll(() => interviews!.reads(BONGANI).length - reads, 'one more read').toBe(1);
      expect(await chosenIndex(page), 'the same interview stays chosen').toBe(at);
      expect(new URL(page.url()).searchParams.get('interview')).toBe(x.id);
      const c = await readChosen(page);
      const status = a === 'cancel' ? IW.cancelled : a === 'did_not_happen' ? IW.didNotHappen : IW.done;
      expect(c.text, 'the new status').toContain(status);
      expect(c.text, 'the reason words').toContain(REASONS[a][0]![1]);
      expect(c.text).not.toMatch(BAD_WORDS);
      const focusedInRow = await rowsOf(page).nth(at).evaluate((li) => li === document.activeElement || li.contains(document.activeElement));
      expect(focusedInRow, 'focus on the chosen interview\'s row').toBe(true);
      await expect(page.locator('.pp-flag, .pp-toast, [role="status"]').filter({ hasText: /\S/ }), 'no toast').toHaveCount(0);
      await noCloseActions(page, 'after the save');
      if (a === 'complete') expect(c.people[0]!.text).toContain(CW.noFeedback);
      else await expect(main(page).getByRole('button', { name: `${SW.schedule}, ${a === 'cancel' ? 'Culture fit' : 'Phone screen'}`, exact: true }), 'INT-UI-02\'s second button, the type in the tab\'s case').toBeVisible();
    });
  }

  test('AC-5 NOT_CANCELLABLE (the start passed meanwhile) and NOT_ALLOWED_NOW (mark as done after someone else cancelled it is closed already as another status): one re-read, W-N1 at the top of the dialog body, the main button stays off, the choice and text stay', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [futureIv('iv-f'), startedIv('iv-s')], 'iv-f');
    // The server's clock passes the start; the page still shows Cancel.
    sched!.now = Date.parse(sast(24, 11));
    let reads = interviews!.reads(BONGANI).length;
    let d = await openAction(page, 'cancel', 'CULTURE_FIT');
    await choose(d, CW.other);
    await noteOf(d).fill('Typed and kept');
    await press(d, 'cancel');
    await expect(dangerOf(d).getByText(CW.changed, { exact: true })).toBeVisible();
    expect(closer!.writes.at(-1)!.status).toBe(409);
    expect(interviews!.reads(BONGANI).length - reads, 'one re-read behind the dialog').toBe(1);
    expect(await isOff(mainButtonOf(d, 'cancel')), 'the main button stays off').toBe(true);
    await expect(reasonOf(d, CW.other)).toBeChecked();
    await expect(noteOf(d)).toHaveValue('Typed and kept');
    const top = await d.locator('.pp-modal-dialog__body').evaluate((b) => { const m = b.querySelector('.pp-section-message--danger'); const r = b.querySelector('[role="radio"], input[type="radio"]'); return !!m && !!r && !!(m.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING); });
    expect(top, 'the message is above the reasons').toBe(true);
    await expect(d.getByText(CW.saveFail, { exact: true })).toHaveCount(0);
    await secondaryOf(d, 'cancel').click();
    // Mark as done, but someone else marked it did-not-happen meanwhile: NOT_ALLOWED_NOW, the re-read shows another closed status.
    sched!.now = Date.parse(sast(19, 10));
    await chooseRow(page, 1);
    d = await openAction(page, 'complete', 'PHONE_SCREEN');
    const x = sched!.listOf(BONGANI).find((i) => i.id === 'iv-s')!;
    x.status = 'DID_NOT_HAPPEN'; x.closed_reason = 'CANDIDATE_DID_NOT_COME'; x.can = canOf('none');
    reads = interviews!.reads(BONGANI).length;
    await choose(d, REASONS.complete[0]![1]);
    await press(d, 'complete');
    await expect(dangerOf(d).getByText(CW.changed, { exact: true })).toBeVisible();
    expect(interviews!.reads(BONGANI).length - reads).toBe(1);
    expect(await isOff(mainButtonOf(d, 'complete'))).toBe(true);
    await expect(reasonOf(d, REASONS.complete[0]![1])).toBeChecked();
  });

  test('AC-5 Did not happen refused because someone gave feedback meanwhile (NOT_ALLOWED_NOW): the re-read shows feedback given, so W-9c "Someone has already given feedback, so this interview can\'t be changed." shows, not W-N1, and the main button stays off', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [startedIv('iv-s', { panel: [SIPHO(), person('Lerato Mokoena', 'WAITING', { person_id: 'sub-a-lerato' })] })], 'iv-s');
    const d = await openAction(page, 'did_not_happen', 'PHONE_SCREEN');
    const x = sched!.listOf(BONGANI)[0]!;
    x.panel = [SIPHO(), voted('Lerato Mokoena', 'YES', 4, null, { person_id: 'sub-a-lerato' })];
    x.can = canOf({ mark_done: true });
    await choose(d, REASONS.did_not_happen[1]![1]);
    await press(d, 'did_not_happen');
    await expect(dangerOf(d).getByText(CW.hasFeedback, { exact: true })).toBeVisible();
    await expect(d.getByText(CW.changed, { exact: true })).toHaveCount(0);
    expect(closer!.writes.at(-1)!.status).toBe(409);
    expect(await isOff(mainButtonOf(d, 'did_not_happen'))).toBe(true);
    await expect(reasonOf(d, REASONS.did_not_happen[1]![1])).toBeChecked();
  });

  test('AC-5 W-9c is for Did not happen with feedback given only: Did not happen refused with nobody\'s feedback given, and Mark as done refused with feedback given, each show W-N1 and not W-9c, main button off, choice kept', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [someFeedbackIv('iv-g'), startedIv('iv-s')], 'iv-s');
    // Did not happen, nobody has given feedback; the server's clock is back before the start, so it refuses (NOT_ALLOWED_NOW).
    sched!.now = Date.parse(sast(19, 7));
    let reads = interviews!.reads(BONGANI).length;
    let d = await openAction(page, 'did_not_happen', 'PHONE_SCREEN');
    await choose(d, REASONS.did_not_happen[0]![1]);
    await press(d, 'did_not_happen');
    await expect(dangerOf(d).getByText(CW.changed, { exact: true })).toBeVisible();
    await expect(d.getByText(CW.hasFeedback, { exact: true }), 'no feedback was given, so not W-9c').toHaveCount(0);
    expect(closer!.writes.at(-1)!.status).toBe(409);
    expect(sched!.listOf(BONGANI).find((i) => i.id === 'iv-s')!.panel.some((e) => e.feedback === 'GIVEN'), 'the re-read shows no feedback').toBe(false);
    expect(interviews!.reads(BONGANI).length - reads).toBe(1);
    expect(await isOff(mainButtonOf(d, 'did_not_happen'))).toBe(true);
    await expect(reasonOf(d, REASONS.did_not_happen[0]![1])).toBeChecked();
    await secondaryOf(d, 'did_not_happen').click();
    await expect(d).toBeHidden();
    // Mark as done on the interview where Lerato has given feedback; the server refuses (clock before its start).
    sched!.now = Date.parse(sast(18, 8));
    await chooseRow(page, 0);
    reads = interviews!.reads(BONGANI).length;
    d = await openAction(page, 'complete', 'TECHNICAL');
    await choose(d, REASONS.complete[0]![1]);
    await press(d, 'complete');
    await expect(dangerOf(d).getByText(CW.changed, { exact: true })).toBeVisible();
    await expect(d.getByText(CW.hasFeedback, { exact: true }), 'W-9c is for Did not happen only').toHaveCount(0);
    expect(closer!.writes.at(-1)!.status).toBe(409);
    expect(sched!.listOf(BONGANI).find((i) => i.id === 'iv-g')!.panel.some((e) => e.feedback === 'GIVEN'), 'the re-read shows feedback given').toBe(true);
    expect(interviews!.reads(BONGANI).length - reads).toBe(1);
    expect(await isOff(mainButtonOf(d, 'complete'))).toBe(true);
    await expect(reasonOf(d, REASONS.complete[0]![1])).toBeChecked();
  });

  test('AC-5 A refusal whose re-read shows the target status (someone else did the same meanwhile) closes the dialog as after 200; a refusal whose re-read fails shows W-N1', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [futureIv('iv-f'), startedIv('iv-s')], 'iv-f');
    let d = await openAction(page, 'cancel', 'CULTURE_FIT');
    const f = sched!.listOf(BONGANI)[0]!;
    f.status = 'CANCELLED'; f.closed_reason = 'PANEL_NOT_AVAILABLE'; f.can = canOf('none');
    await choose(d, REASONS.cancel[0]![1]);
    await press(d, 'cancel');
    await expect(d, 'closed as saved').toBeHidden();
    expect(closer!.writes.at(-1)!.status).toBe(409);
    expect(await chosenIndex(page)).toBe(0);
    expect((await readChosen(page)).text).toContain(IW.cancelled);
    // A refusal, then the re-read fails: W-N1.
    await chooseRow(page, 1);
    d = await openAction(page, 'complete', 'PHONE_SCREEN');
    sched!.listOf(BONGANI)[1]!.status = 'COMPLETED';
    // Keep the page's copy unchanged until the read: refuse the read.
    interviews!.refuse({ status: 500, id: BONGANI });
    await choose(d, REASONS.complete[0]![1]);
    await press(d, 'complete');
    await expect(dangerOf(d).getByText(CW.changed, { exact: true })).toBeVisible();
    expect(await isOff(mainButtonOf(d, 'complete'))).toBe(true);
  });

  test('AC-5 Every other answer (400 INVALID_FIELD reason, 403, 404, 409 KEY_IN_USE, 409 KEY_REUSED, 500) shows "Your change could not be saved. Try again." at the top with the choice and text kept and the main button back on; no re-read is needed for these', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [startedIv('iv-s')], 'iv-s');
    const d = await openAction(page, 'did_not_happen', 'PHONE_SCREEN');
    await choose(d, CW.other);
    await noteOf(d).fill('Kept through failures');
    const answers: Array<[number, unknown]> = [
      [400, { error: 'Bad request', code: 'INVALID_FIELD', field: 'reason' }], [403, { error: 'Forbidden' }], [404, { error: 'Not found' }],
      [409, { error: 'Conflict', code: 'KEY_IN_USE' }], [409, { error: 'Conflict', code: 'KEY_REUSED' }], [500, { error: 'Internal error' }],
    ];
    for (const [status, body] of answers) {
      closer!.refuse({ status, body });
      await press(d, 'did_not_happen');
      await expect(dangerOf(d).getByText(CW.saveFail, { exact: true }), `${status} ${JSON.stringify(body)}`).toBeVisible();
      await expect(d.getByText(CW.changed, { exact: true })).toHaveCount(0);
      await expect(reasonOf(d, CW.other)).toBeChecked();
      await expect(noteOf(d)).toHaveValue('Kept through failures');
      await expect.poll(() => isOff(mainButtonOf(d, 'did_not_happen')), 'the main button back on').toBe(false);
    }
    expect(closer!.writes).toHaveLength(answers.length);
    await press(d, 'did_not_happen');
    await expect(d).toBeHidden();
    expect(closer!.writes.at(-1)!.status).toBe(200);
  });

  test('AC-5 A lost answer (the fake saves, then drops the connection): one re-read, then the dialog closes as after 200 and no second PATCH is sent; a request lost before it saved: one re-read, the save-failure line, and the next press reuses the key', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [futureIv('iv-f'), startedIv('iv-s')], 'iv-f');
    let reads = interviews!.reads(BONGANI).length;
    let d = await openAction(page, 'cancel', 'CULTURE_FIT');
    await choose(d, REASONS.cancel[2]![1]);
    closer!.refuse({ thenAbort: true });
    await press(d, 'cancel');
    await expect(d).toBeHidden();
    await page.waitForTimeout(400);
    expect(closer!.writes, 'no second PATCH').toHaveLength(1);
    expect(interviews!.reads(BONGANI).length - reads, 'one re-read').toBe(1);
    expect((await readChosen(page)).text).toContain(IW.cancelled);
    expect(await chosenIndex(page)).toBe(0);
    // Lost before it saved.
    await chooseRow(page, 1);
    reads = interviews!.reads(BONGANI).length;
    d = await openAction(page, 'complete', 'PHONE_SCREEN');
    await choose(d, REASONS.complete[1]![1]);
    closer!.refuse({ abort: true });
    await press(d, 'complete');
    await expect(dangerOf(d).getByText(CW.saveFail, { exact: true })).toBeVisible();
    expect(interviews!.reads(BONGANI).length - reads, 'one re-read before the button comes back').toBe(1);
    await expect.poll(() => isOff(mainButtonOf(d, 'complete'))).toBe(false);
    await press(d, 'complete');
    await expect(d).toBeHidden();
    expect(closer!.writes).toHaveLength(3);
    expect(closer!.writes[2]!.idempotencyKey, 'the retry reuses the key').toBe(closer!.writes[1]!.idempotencyKey);
    expect(closer!.writes[2]!.status).toBe(200);
  });
});

// ================================================================ AC-6 Closing and focus
test.describe('AC-6 Closing and focus', () => {
  test.beforeEach(noBackendOnly);

  test('AC-6 "Close", the secondary button, Escape and the blanket each close the dialog with no request, return focus to what opened it (More actions on desktop, the button on a phone), and opening again shows nothing chosen and no text', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [startedIv('iv-s')], 'iv-s');
    const closers: Array<[string, (d: Locator) => Promise<void>]> = [
      ['Close', (d) => closeButtonOf(d).click()],
      ['the secondary button', (d) => secondaryOf(d, 'complete').click()],
      ['Escape', async () => { await page.keyboard.press('Escape'); }],
      ['the blanket', async (d) => { const b = (await d.boundingBox())!; await page.mouse.click(5, Math.max(5, b.y - 20)); }],
    ];
    for (const [how, shut] of closers) {
      const d = await openAction(page, 'complete', 'PHONE_SCREEN');
      await choose(d, CW.other);
      await noteOf(d).fill(`typed before ${how}`);
      await shut(d);
      await expect(d, `${how} closes it`).toBeHidden();
      await expect(openerOf(page, 'complete'), `${how}: focus returns to the opener`).toBeFocused();
      const again = await openAction(page, 'complete', 'PHONE_SCREEN');
      expect((await reasonsIn(again)).filter((r) => r.checked), `${how}: nothing chosen on reopening`).toEqual([]);
      await expect(noteOf(again)).toHaveCount(0);
      await choose(again, CW.other);
      await expect(noteOf(again), `${how}: no text on reopening`).toHaveValue('');
      await secondaryOf(again, 'complete').click();
      await expect(again).toBeHidden();
    }
    expect(closer!.writes, 'no request').toHaveLength(0);
  });

  test('AC-6 Focus moves into the dialog when it opens; a dialog closed while its request is in flight: the late answer only re-reads the tab and opens nothing', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [futureIv('iv-f')], 'iv-f');
    const d = await openAction(page, 'cancel', 'CULTURE_FIT');
    await expect.poll(() => d.evaluate((el) => el.contains(document.activeElement)), 'focus moves into the dialog').toBe(true);
    await choose(d, REASONS.cancel[0]![1]);
    closer!.refuse({ hold: true });
    await mainButtonOf(d, 'cancel').click();
    await expect.poll(() => closer!.heldCount).toBe(1);
    await expect.poll(() => isOff(mainButtonOf(d, 'cancel')), 'off while sending').toBe(true);
    await page.keyboard.press('Escape');
    await expect(d).toBeHidden();
    const reads = interviews!.reads(BONGANI).length;
    closer!.release();
    await expect.poll(() => interviews!.reads(BONGANI).length - reads, 'the late answer re-reads the tab').toBe(1);
    await quiet(page);
    await page.waitForTimeout(400);
    await expect(anyDialog(page), 'opens nothing').toHaveCount(0);
    expect((await readChosen(page)).text).toContain(IW.cancelled);
    expect(closer!.writes).toHaveLength(1);
  });
});

// ================================================================ AC-7 Company B and sign-out
test.describe('AC-7 Company B and sign-out', () => {
  test.beforeEach(noBackendOnly);

  test('AC-7 Company B\'s Recruiter on A\'s candidate sees "This candidate could not be found.", no More actions and no action buttons, and sends no PATCH; on B\'s own candidate B\'s actions work for B', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    sched!.set(BONGANI, [futureIv('iv-f'), startedIv('iv-s')]);
    sched!.set(B_CAND, [futureIv('iv-b', { type: 'FINAL', panel: [person('Lindiwe Peters', 'WAITING', { person_id: 'sub-b-lindiwe' })] })]);
    modules!.answers.B = ['onboarding', 'recruitment'];
    await asRecruiter(fx, WHO.recruiterB);
    for (const q of ['?tab=interviews', '?tab=interviews&interview=iv-f', '?tab=interviews&interview=iv-s']) {
      await openAt(page, BONGANI, q);
      await expect(main(page).getByText(IW.notFound, { exact: true })).toBeVisible();
      await quiet(page);
      await noCloseActions(page, q);
      expect(await page.content()).not.toContain('Bongani');
    }
    expect(closer!.writes, 'no PATCH').toHaveLength(0);
    await openAt(page, B_CAND, '?tab=interviews&interview=iv-b');
    await interviewsDrawn(page);
    const d = await openAction(page, 'cancel', 'FINAL');
    await choose(d, REASONS.cancel[1]![1]);
    await press(d, 'cancel');
    await expect(d).toBeHidden();
    const c = closer!.writes.at(-1)!;
    expect([c.email, c.status, c.path]).toEqual([WHO.recruiterB.email, 200, `/v1/candidates/${B_CAND}/interviews/iv-b`]);
    expect(companyIdIn(c)).toEqual([]);
  });

  test('AC-7 A\'s Recruiter signs out with a dialog open (Other chosen, text typed, the save answer held); the dialog closes; B\'s Recruiter signs in on the page the app left (no reload) and opens B\'s dialog: nothing of A\'s dialog, choice or text shows at any moment, also when A\'s held answer arrives late', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    sched!.set(B_CAND, [futureIv('iv-b', { type: 'FINAL', panel: [person('Lindiwe Peters', 'WAITING', { person_id: 'sub-b-lindiwe' })] })]);
    await onTab(fx, [futureIv('iv-f')], 'iv-f');
    const d = await openAction(page, 'cancel', 'CULTURE_FIT');
    await choose(d, CW.other);
    await noteOf(d).fill('A-only cancel reason text');
    closer!.refuse({ hold: true });
    await mainButtonOf(d, 'cancel').click();
    await expect.poll(() => closer!.heldCount).toBe(1);
    await avatarButton(page).dispatchEvent('click');
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).dispatchEvent('click');
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(anyDialog(page), 'signing out closes the dialog').toHaveCount(0);
    const aWords = ['A-only cancel reason text', 'Cancel the culture fit interview?', 'Bongani', 'Culture fit'];
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
    await inApp(page, `/hire/candidates/${B_CAND}?tab=interviews&interview=iv-b`);
    await interviewsDrawn(page);
    const b = await openAction(page, 'cancel', 'FINAL');
    closer!.release();
    await quiet(page);
    await page.waitForTimeout(500);
    await expect(b, 'A\'s late answer closes nothing of B').toBeVisible();
    expect((await reasonsIn(b)).filter((r) => r.checked), 'nothing chosen in B\'s dialog').toEqual([]);
    await choose(b, CW.other);
    await expect(noteOf(b)).toHaveValue('');
    expect(await seenA(), 'nothing of A at any moment').toEqual([]);
    await secondaryOf(b, 'cancel').click();
  });
});

// ================================================================ AC-8 Words
test.describe('AC-8 Words', () => {
  test.beforeEach(noBackendOnly);

  test('AC-8 Every visible string and accessible name in the menu and the three dialogs, in every state (opened, a reason chosen, Other with text, sending, refused as changed, W-9c, save failed, with and without a guest), is an approved word, an existing app word or a W-N line, exactly; no ⟦, "null", "undefined", "NaN", "Invalid Date" or reason code', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    const typed = 'Moved to next week';
    const check = async (l: Locator, typeKey: string, where: string) => {
      const ok = allowedWords(typeKey, [typed]);
      const words = await wordsIn(l);
      const bad = words.map((w) => w.replace(/[\s  ]+/g, ' ').trim()).filter((w) => w && !ok.has(w));
      expect(bad, `${where}: words not on the list`).toEqual([]);
      expect(words.join(' | '), where).not.toMatch(BAD_WORDS);
    };
    await onTab(fx, [
      futureIv('iv-f', { panel: [SIPHO(), guest('Naledi Guest', 'WAITING')] }),
      startedIv('iv-s', { panel: [SIPHO(), guest(null, 'WAITING')] }),
      startedIv('iv-n', { type: 'TECHNICAL', at: sast(19, 9) }),
    ], 'iv-f');
    for (const [row, a, key] of [[0, 'cancel', 'CULTURE_FIT'], [1, 'did_not_happen', 'PHONE_SCREEN'], [1, 'complete', 'PHONE_SCREEN'], [2, 'complete', 'TECHNICAL']] as const) {
      await chooseRow(page, row);
      if (!isPhone()) {
        await moreActions(page).click();
        await check(menuOf(page), key, `${a}: the menu`);
        await expect(moreActions(page)).toHaveAccessibleName(menuName(key));
        await page.keyboard.press('Escape');
      } else for (const x of ACTIONS) if (await actionButton(page, x).count()) await check(actionButton(page, x), key, `${x} button`);
      const d = await openAction(page, a, key);
      await check(d, key, `${a}: opened`);
      await choose(d, REASONS[a][0]![1]);
      await check(d, key, `${a}: a reason`);
      await choose(d, CW.other);
      await noteOf(d).fill(typed);
      await check(d, key, `${a}: Other with text`);
      closer!.refuse({ hold: true });
      await mainButtonOf(d, a).click();
      await expect.poll(() => closer!.heldCount).toBe(1);
      await check(d, key, `${a}: sending`);
      // The held save goes through and closes the dialog; then the interviews are put back for the next states.
      closer!.release();
      await expect(d).toBeHidden();
      sched!.set(BONGANI, [
        futureIv('iv-f', { panel: [SIPHO(), guest('Naledi Guest', 'WAITING')] }),
        startedIv('iv-s', { panel: [SIPHO(), guest(null, 'WAITING')] }),
        startedIv('iv-n', { type: 'TECHNICAL', at: sast(19, 9) }),
      ], { done: 1, total: 3 });
      await openAt(page, BONGANI, `?tab=interviews&interview=${['iv-f', 'iv-s', 'iv-n'][row]}`);
      await interviewsDrawn(page);
      const e = await openAction(page, a, key);
      await choose(e, REASONS[a][1]![1]);
      closer!.refuse({ status: 500 });
      await press(e, a);
      await expect(dangerOf(e)).toBeVisible();
      await check(e, key, `${a}: save failed`);
      // Refused as changed (cancel: the start passed; did not happen: feedback given; mark as done: closed meanwhile).
      const x = sched!.listOf(BONGANI)[row]!;
      if (a === 'cancel') sched!.now = Date.parse(sast(24, 11));
      else if (a === 'did_not_happen') x.panel = [voted('Sipho Ndlovu', 'YES', 4, null, { person_id: 'sub-a-sipho' }), guest(null, 'WAITING')];
      else x.status = 'CANCELLED';
      await press(e, a);
      await expect(dangerOf(e).getByText(a === 'did_not_happen' ? CW.hasFeedback : CW.changed, { exact: true })).toBeVisible();
      await check(e, key, `${a}: refused`);
      sched!.now = hire!.world.now;
      await secondaryOf(e, a).click();
      await expect(e).toBeHidden();
      sched!.set(BONGANI, [
        futureIv('iv-f', { panel: [SIPHO(), guest('Naledi Guest', 'WAITING')] }),
        startedIv('iv-s', { panel: [SIPHO(), guest(null, 'WAITING')] }),
        startedIv('iv-n', { type: 'TECHNICAL', at: sast(19, 9) }),
      ], { done: 1, total: 3 });
      await openAt(page, BONGANI, `?tab=interviews&interview=${['iv-f', 'iv-s', 'iv-n'][row]}`);
      await interviewsDrawn(page);
    }
  });

  test('AC-8 The words table: the new lines are plain strings in interview-words.ts (with the {type} marker); the words check passes on it, fails on a planted null row and fails on a planted empty string', async () => {
    desktopOnly('it checks files, not the page');
    const repo = join(__dirname, '..', '..', '..');
    const script = join(repo, 'scripts', 'ci', 'check-interview-words.mjs');
    const words = join(repo, 'pepla-web', 'src', 'app', 'features', 'recruitment', 'interviews', 'interview-words.ts');
    const text = readFileSync(words, 'utf8');
    const plain = text.replace(/\\'/g, '\'').replace(/\\"/g, '"');
    const rows = [
      'Cancel the {type} interview?', 'Record that the {type} interview did not happen', 'Mark the {type} interview as done?',
      'Nobody is emailed. You can book a {type} interview again afterwards.', CW.cancelGuest, CW.doneGuest, CW.doneNoGuest, CW.changed,
      CW.reason, CW.describe, CW.keep, CW.save, 'More actions for the {type} interview',
    ];
    const body = plain.slice(plain.indexOf('INTERVIEW_WORDS'), plain.indexOf('};', plain.indexOf('INTERVIEW_WORDS')));
    for (const w of rows) expect(body, `INTERVIEW_WORDS holds "${w}" as a plain string`).toMatch(new RegExp(`(['"\`])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`));
    const run = (args: string[]): number => {
      try { execFileSync('node', [script, ...args], { cwd: repo, stdio: 'pipe' }); return 0; } catch (e) { return (e as { status?: number }).status ?? 1; }
    };
    expect(run([]), 'the check passes on the real table').toBe(0);
    const literal = (w: string) => new RegExp(`(['"\`])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, '(?:\\\\\'|\')').replace(/"/g, '(?:\\\\"|")')}\\1`).exec(text);
    const changed = literal(CW.changed);
    const keep = literal(CW.keep);
    expect(changed && keep, 'both rows are string literals').toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), 'int-ui-03-'));
    try {
      const copy = join(dir, 'interview-words.ts');
      writeFileSync(copy, text);
      expect(run([copy]), 'the check passes on an exact copy').toBe(0);
      writeFileSync(copy, text.replace(changed![0], 'null'));
      expect(run([copy]), 'a planted null row fails the check').not.toBe(0);
      writeFileSync(copy, text.replace(keep![0], '\'\''));
      expect(run([copy]), 'a planted empty string fails the check').not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ================================================================ AC-9 Phone and keyboard
test.describe('AC-9 Phone and keyboard', () => {
  test.beforeEach(noBackendOnly);

  test('AC-9 At 390 the dialog is the bottom sheet: full width at the bottom, the main button above the secondary button, both visible without scrolling, nothing under the top bar, nothing scrolling sideways; the phone action buttons are visible and not covered; at 1280 the dialog is centred', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [startedIv('iv-s', { panel: [SIPHO(), guest('Naledi Guest', 'WAITING')] })], 'iv-s');
    const vp = page.viewportSize()!;
    if (isPhone()) {
      for (const a of ['did_not_happen', 'complete'] as const) {
        const b = actionButton(page, a);
        await b.scrollIntoViewIfNeeded();
        const hit = await b.evaluate((el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (el === h || el.contains(h)) && r.left >= 0 && r.right <= document.documentElement.clientWidth; });
        expect(hit, `${a}: visible and not covered`).toBe(true);
        expect((await b.boundingBox())!.height, `${a}: the touch size`).toBeGreaterThanOrEqual(40);
      }
    }
    for (const a of ['did_not_happen', 'complete'] as const) {
      const d = await openAction(page, a, 'PHONE_SCREEN');
      await choose(d, CW.other);
      await noteOf(d).fill('Typed on a phone');
      await page.waitForTimeout(500); // the sheet's slide-in
      const box = (await d.boundingBox())!;
      const main_ = (await mainButtonOf(d, a).boundingBox())!;
      const sec = (await secondaryOf(d, a).boundingBox())!;
      if (isPhone()) {
        expect([Math.round(box.x), Math.round(box.width)], 'full width').toEqual([0, vp.width]);
        expect(Math.round(box.y + box.height), 'at the bottom').toBe(vp.height);
        expect(main_.y + main_.height, 'the main button above the secondary button').toBeLessThanOrEqual(sec.y + 1);
        for (const [n, r] of [['main', main_], ['secondary', sec]] as const) {
          expect(r.y, `${n} button on screen`).toBeGreaterThanOrEqual(0);
          expect(r.y + r.height, `${n} button on screen`).toBeLessThanOrEqual(vp.height + 1);
          expect(r.height, `${n}: the touch size`).toBeGreaterThanOrEqual(40);
        }
      } else {
        expect(Math.abs(box.x + box.width / 2 - vp.width / 2), 'centred across').toBeLessThan(4);
        expect(Math.abs(box.y + box.height / 2 - vp.height / 2), 'centred down').toBeLessThan(4);
        expect(box.width, 'not the full width').toBeLessThan(vp.width * 0.8);
      }
      const problems = await d.evaluate((dlg) => {
        const out: string[] = [];
        const width = document.documentElement.clientWidth;
        for (const el of dlg.querySelectorAll<HTMLElement>('.pp-modal-dialog__footer button, .pp-modal-dialog__title, input')) {
          const r = el.getBoundingClientRect();
          const label = `${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 30)}"`;
          if (r.left < -1 || r.right > width + 1) out.push(`${label} is cut off sideways`);
          if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'radio') continue;
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 10));
          if (hit && !el.contains(hit) && !hit.contains(el)) out.push(`${label} is covered by ${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}`);
        }
        const bar = document.querySelector('pp-top-navigation');
        const r = bar?.getBoundingClientRect();
        if (r && r.height) { const top = document.elementFromPoint(width / 2, r.top + r.height / 2); if (top && bar!.contains(top)) out.push('the top bar shows over the dialog'); }
        if (document.documentElement.scrollWidth > width + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth})`);
        const body = dlg.querySelector('.pp-modal-dialog__body');
        if (body && body.scrollWidth > body.clientWidth + 1) out.push('the dialog body scrolls sideways');
        return out;
      });
      expect(problems, a).toEqual([]);
      await secondaryOf(d, a).click();
      await expect(d).toBeHidden();
    }
  });

  test('AC-9 Desktop: resizing across 768 swaps the menu for the buttons and back, only one set in the page at a time, and an open dialog stays open', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    desktopOnly('it resizes the desktop window across the phone line');
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [startedIv('iv-s')], 'iv-s');
    await expect(moreActions(page)).toHaveCount(1);
    await page.setViewportSize({ width: 767, height: 800 });
    await expect(moreActions(page), 'no menu under 768').toHaveCount(0);
    await expect(actionButton(page, 'complete')).toBeVisible();
    await page.setViewportSize({ width: 768, height: 800 });
    await expect(moreActions(page), 'the menu from 768').toHaveCount(1);
    await expect(actionButton(page, 'complete')).toHaveCount(0);
    const d = await openAction(page, 'did_not_happen', 'PHONE_SCREEN');
    await choose(d, CW.other);
    await noteOf(d).fill('Still here');
    await page.setViewportSize({ width: 390, height: 800 });
    await expect(d, 'the dialog stays open').toBeVisible();
    await expect(noteOf(d)).toHaveValue('Still here');
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(d).toBeVisible();
    await secondaryOf(d, 'did_not_happen').click();
  });

  test('AC-9 Each action can be done with the keyboard only: reach the menu (or the phone button) with Tab, the menu keys (ArrowDown, End, Home, Escape back to the button), a reason with Space and the arrows, the text, the main button with Enter; Escape closes a dialog and focus returns to the opener', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer };
    await onTab(fx, [startedIv('iv-s')], 'iv-s');
    const tabTo = async (target: Locator, what: string) => {
      for (let i = 0; i < 60; i++) {
        if (await target.evaluate((el) => el === document.activeElement)) return;
        await page.keyboard.press('Tab');
      }
      throw new Error(`Tab never reached ${what}`);
    };
    await rowsOf(page).first().focus();
    if (isPhone()) {
      await tabTo(actionButton(page, 'complete'), 'Mark as done');
      await page.keyboard.press('Enter');
    } else {
      await tabTo(moreActions(page), 'More actions');
      await page.keyboard.press('Enter');
      await expect(menuOf(page)).toBeVisible();
      const item = (n: string) => menuOf(page).getByRole('menuitem', { name: n, exact: true });
      await expect(item(CW.didNotHappen), 'the first item takes focus').toBeFocused();
      await page.keyboard.press('End');
      await expect(item(CW.markDone)).toBeFocused();
      await page.keyboard.press('Home');
      await expect(item(CW.didNotHappen)).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(item(CW.markDone)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menuOf(page)).toHaveCount(0);
      await expect(moreActions(page), 'Escape returns focus to the button').toBeFocused();
      await expect(moreActions(page), 'the button says the menu is shut').toHaveAttribute('aria-expanded', 'false');
      await page.keyboard.press('Enter');
      await expect(item(CW.didNotHappen)).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(item(CW.markDone)).toBeFocused();
      await page.keyboard.press('Enter');
    }
    const d = dialogOf(page, 'complete', 'PHONE_SCREEN');
    await expect(d).toBeVisible();
    await expect.poll(() => d.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    const first = reasonOf(d, REASONS.complete[0]![1]);
    await tabTo(first, 'the first reason');
    await page.keyboard.press('Space');
    await expect(first).toBeChecked();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(reasonOf(d, CW.other)).toBeChecked();
    await tabTo(noteOf(d), 'Describe the reason');
    await page.keyboard.type('Done by keyboard');
    await tabTo(mainButtonOf(d, 'complete'), 'Mark as done');
    await page.keyboard.press('Enter');
    await expect(d).toBeHidden();
    expect(bodyOf(closer!.writes.at(-1)!)).toEqual({ action: 'complete', reason: 'OTHER', reason_note: 'Done by keyboard' });
    // Escape on another opening returns focus to the opener.
    sched!.set(BONGANI, [futureIv('iv-f')], { done: 1, total: 3 });
    await openAt(page, BONGANI, '?tab=interviews&interview=iv-f');
    await interviewsDrawn(page);
    await rowsOf(page).first().focus();
    const opener = openerOf(page, 'cancel');
    await tabTo(opener, 'the opener');
    await page.keyboard.press('Enter');
    if (!isPhone()) { await expect(menuOf(page).getByRole('menuitem', { name: CW.cancel, exact: true })).toBeFocused(); await page.keyboard.press('Enter'); }
    const c = dialogOf(page, 'cancel', 'CULTURE_FIT');
    await expect(c).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(c).toBeHidden();
    await expect(opener, 'focus returns to the opener').toBeFocused();
  });
});

// ================================================================ AC-10 pepla-dev
test.describe('AC-10 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-10 runs on pepla-dev only.');
  // The dev step runs every @pepla-dev test once per width and seeds once, so each width has its own candidate and pair (M-1, D13).
  type DevIds = { candidate: string; lastName: string; cancel: { id: string; type: string }; done: { id: string; type: string } };
  const ALL = JSON.parse(readFileSync(join(__dirname, 'support', 'int-ui', 'dev-ids-03.json'), 'utf8')) as Record<string, DevIds>;
  const devOf = (): DevIds => { const d = ALL[test.info().project.name]; if (!d) throw new Error(`dev-ids-03.json has no entry for ${test.info().project.name}`); return d; };
  const keyOf = (words: string) => words.toUpperCase().replace(/ /g, '_');

  test('AC-10 @pepla-dev The company A HR login opens the seeded candidate at ?tab=interviews, cancels the future interview with "Candidate asked" and sees "Cancelled"; marks the started interview with no feedback as done with "Other" and a short text and sees "Done" and "No feedback" on its panel line', async ({ page, signIn, hr }) => {
    const DEV = devOf();
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto(`/hire/candidates/${DEV.candidate}?tab=interviews`);
    await expect(personHeader(page)).toBeVisible();
    await interviewsDrawn(page);
    await expect(main(page).getByText(IW.failed, { exact: true })).toHaveCount(0);
    let rows = await readRows(page);
    const ci = rows.findIndex((r) => r.text.startsWith(DEV.cancel.type));
    expect(ci, `the seeded ${DEV.cancel.type} interview`).toBeGreaterThanOrEqual(0);
    await chooseRow(page, ci);
    let d = await openAction(page, 'cancel', keyOf(DEV.cancel.type));
    await choose(d, REASONS.cancel[0]![1]);
    await press(d, 'cancel');
    await expect(d).toBeHidden({ timeout: 20_000 });
    await expect.poll(async () => (await readChosen(page)).text, { timeout: 15_000 }).toContain(IW.cancelled);
    expect((await readChosen(page)).text).toContain(REASONS.cancel[0]![1]);
    rows = await readRows(page);
    const di = rows.findIndex((r) => r.text.startsWith(DEV.done.type));
    expect(di, `the seeded ${DEV.done.type} interview`).toBeGreaterThanOrEqual(0);
    await chooseRow(page, di);
    d = await openAction(page, 'complete', keyOf(DEV.done.type));
    await choose(d, CW.other);
    await noteOf(d).fill('Closed by the pepla-dev check');
    await press(d, 'complete');
    await expect(d).toBeHidden({ timeout: 20_000 });
    await expect.poll(async () => (await readChosen(page)).text, { timeout: 15_000 }).toContain(IW.done);
    const c = await readChosen(page);
    expect(c.people.length, 'one panel line').toBeGreaterThan(0);
    expect(c.people[0]!.text).toContain(CW.noFeedback);
    expect(c.text).not.toMatch(BAD_WORDS);
    test.info().annotations.push({ type: 'record', description: page.url() });
  });

  test('AC-10 @pepla-dev Company B\'s HR login opening that candidate sees no More actions and no name of A. It fails when E2E_B_HR_* is not set (a skip is not a pass)', async ({ page, signIn }) => {
    const DEV = devOf();
    const email = process.env['E2E_B_HR_EMAIL'], password = process.env['E2E_B_HR_PASSWORD'];
    expect(email && password, 'E2E_B_HR_EMAIL and E2E_B_HR_PASSWORD must be set on the dev run: the company B half cannot be skipped').toBeTruthy();
    await signIn.open();
    await signIn.signInAs({ email: email!, password: password! });
    await expect(page).toHaveURL('/hr');
    await openNav(page);
    const recruitmentOn = (await navLabels(page)).includes('Candidates');
    for (const q of ['?tab=interviews', `?tab=interviews&interview=${DEV.cancel.id}`, `?tab=interviews&interview=${DEV.done.id}`]) {
      await page.goto(`/hire/candidates/${DEV.candidate}${q}`);
      await quiet(page);
      if (recruitmentOn) await expect(main(page).getByText(IW.notFound, { exact: true })).toBeVisible();
      else await expect(page).toHaveURL('/hr');
      await noCloseActions(page, q);
      expect(await page.content()).not.toContain(DEV.lastName);
    }
  });
});
