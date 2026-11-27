import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { ON_DEV, avatarButton, type SignInPage } from './support/fixtures';
import type { CognitoFake } from './support/cognito-fake';
import type { ModulesFake } from './support/mod-02/modules-fake';
import { navLabels, openNav } from './support/mod-02/shell-snapshot';
import { WHO, companyIdIn, enter, iso, quiet, watchErrors, type HireFake, type Who } from './support/rec-ui/harness';
import { detailsCard, nextStepCard, personHeader, readHeader, type RecordFake } from './support/rec-ui-02/record';
import type { EventsFake } from './support/rec-ui-02/notes';
import {
  ACTION_WORDS, ALL_REASON_WORDS, CHOSEN, IW, LIST, NEVER, NEVER_DAY, REASON_WORDS, CAN_KEYS, DEFAULT_PLACE, canOf, capturedBy, chooseInterviews, chosenOf, countLine, expect,
  feedbackWords, guest, inApp, interviewsDrawn, interviewsRegion, iv, leftover, main, overdueWords, person, readChosen, readRows, rowsOf, sastDay, sastTime,
  tab, test, typeWords, voted, waitingOn, type Entry, type InterviewsFake, type Iv, type Required,
} from './support/int-ui/interviews';

/**
 * INT-UI-01 · The Interviews tab on the candidate record: a Recruiter sees every interview of a candidate with its state, and the
 * chosen interview's details, people and feedback. No action button shows in this card; it reads one route and writes nothing.
 * Jira NH-270 (epic NH-223, amber). Lock acceptance-lock/int-ui-01 (one squashed commit on acceptance-lock/rec-ui-02.4); the child
 * lock acceptance-lock/rec-ui-02.5 changes the exact tab lists of AC-R8 and AC-N1.
 * Spec: specs/interview-journey/cards/INT-UI-01.md, section "Changes after spec check round 1 (26 Nov)" (M-1 to M-7, S-1 to S-7,
 * final AC-1 to AC-10, decisions INT-UI-01-D1 to D12), its check INT-UI-01-spec-check.md (rounds 1 and 2; C-1, C-2, N-1 to N-3).
 * Backend: `GET /v1/candidates/{id}/interviews` on develop 7630b3c (INT-01). The answer is built from api/openapi.yaml `InterviewList`
 * and checked against it (support/int-ui/interviews.ts). Where the spec is silent, cards/int-ui-01.md says what these tests take.
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg (08:00 UTC).
 * AC-10 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 */

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');
const desktopOnly = (why: string) => test.skip(test.info().project.name !== 'desktop-1280', `Desktop only: ${why}`);

type Fx = { page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null; record: RecordFake | null; events: EventsFake | null; interviews: InterviewsFake | null };
const fxOf = (a: Fx): Fx => a;

const HOUR = 3_600_000;
const DAY = 86_400_000;
const BONGANI = 'cand-bongani';
const TENDAI = 'cand-tendai';
const AMAHLE = 'cand-amahle';
const PULE = 'cand-w3';
/** The fixed page time of the harness: 19 Nov 2026 08:00 UTC, 10:00 in Johannesburg. */
const NOW = Date.UTC(2026, 10, 19, 8, 0, 0);
/** A time on a November 2026 day, given in Johannesburg hours. */
const sast = (day: number, hh: number, mm = 0) => iso(Date.UTC(2026, 10, day, hh - 2, mm));

async function asRecruiter(fx: Fx, who: Who = WHO.recruiterA): Promise<void> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
}
/** Opens a record at an address with a query, and waits for the header (or the not-found or failure line). */
async function openAt(page: Page, id: string, query = ''): Promise<void> {
  await page.goto(`/hire/candidates/${id}${query}`);
  await expect(personHeader(page).or(main(page).getByText(IW.notFound, { exact: true })).or(main(page).getByText('This candidate could not be loaded.', { exact: true })).first()).toBeVisible();
}
/** The status word S-2 and S-5 give a row (null: none). */
function statusWord(x: Iv): string | null {
  if (x.status === 'COMPLETED') return IW.done;
  if (x.status === 'CANCELLED') return IW.cancelled;
  if (x.status === 'DID_NOT_HAPPEN') return IW.didNotHappen;
  if (x.status === 'SCHEDULED' && x.at && Date.parse(x.at) < NOW) {
    const n = x.panel.filter((e) => e.feedback === 'WAITING').length;
    return n ? waitingOn(n) : null;
  }
  return null;
}
/** The parts a row shows, in the order the kit draws them: type words, day, time, status word. */
const rowParts = (x: Iv) => [typeWords(x.type), x.at ? sastDay(x.at) : null, x.at ? sastTime(x.at) : null, statusWord(x)];
/** Clicks the n-th row and waits until it is the chosen one. */
async function choose(page: Page, n: number): Promise<void> {
  await rowsOf(page).nth(n).click();
  await expect.poll(async () => (await readRows(page)).findIndex((r) => r.selected), { message: `row ${n} is chosen` }).toBe(n);
}
const BAD_WORDS = /\b(null|undefined|NaN)\b|Invalid Date|\[object Object\]/;
/** Every control in `main`, by what it says (text or label): buttons, links, menu items. */
async function controls(page: Page): Promise<string[]> {
  return main(page).evaluate((m) => [...m.querySelectorAll('button, a, [role="button"], [role="menuitem"], [role="link"]')]
    .map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`.replace(/\s+/g, ' ').trim()));
}
/** M-4: no action of a later card shows anywhere on the page: no button, link or menu item with its words. (More actions and its menu
 *  are INT-UI-03's since child lock int-ui-01.2.) */
async function noActions(page: Page, where: string): Promise<void> {
  const found = (await controls(page)).filter((c) => ACTION_WORDS.some((w) => c.includes(w)));
  expect(found, `${where}: no action control`).toEqual([]);
}

// The kit's data, as the server would send it for Bongani (company A, Interview stage): seven interviews, oldest first, one of each kind.
const L_THABO = 'Thabo Khumalo';
function bonganiList(): Iv[] {
  return [
    iv('iv-1', sast(3, 9, 30), 'COMPLETED', { type: 'PHONE_SCREEN', panel: [voted('Thandeka Dlamini', 'YES', 4)] }),
    iv('iv-2', sast(6, 14), 'CANCELLED', { type: 'TECHNICAL', closed_reason: 'CANDIDATE_ASKED', panel: [person('Sipho Ndlovu', 'WAITING', { due_at: sast(8, 14) }), person('Lerato Mokoena', 'WAITING', { due_at: sast(8, 14) })] }),
    iv('iv-3', sast(10, 10), 'DID_NOT_HAPPEN', { type: 'BEHAVIORAL', closed_reason: 'CANDIDATE_DID_NOT_COME', panel: [person('Sipho Ndlovu', 'WAITING', { due_at: sast(12, 10) })] }),
    iv('iv-4', sast(17, 10), 'SCHEDULED', {
      type: 'CULTURE_FIT', panel: [voted('Sipho Ndlovu', 'YES', 4), person('Lerato Mokoena', 'WAITING', { due_at: sast(18, 10) }), guest(null, 'WAITING')],
    }),
    iv('iv-5', sast(18, 15), 'SCHEDULED', { type: 'FINAL', panel: [voted('Sipho Ndlovu', 'NO', 2), voted(L_THABO, 'YES', 3.5)] }),
    iv('iv-6', sast(24, 9), 'SCHEDULED', {
      type: 'PANEL_REVIEW', panel: [person('Sipho Ndlovu', 'WAITING'), person('Lerato Mokoena', 'WAITING'), person(L_THABO, 'WAITING'), person('Ayanda Mkhize', 'WAITING')],
    }),
    iv('iv-7', sast(26, 11), null, { type: null, panel: [person('Sipho Ndlovu', 'WAITING')] }),
  ];
}

// ================================================================ AC-1 List and count (M-3, S-1, S-2, S-5)
test.describe('AC-1 List and count', () => {
  test.beforeEach(noBackendOnly);

  test('AC-1 One row per interview in the answer\'s order, closed ones included: type words (the five known, others in sentence case, none when missing), day and 24-hour time in Johannesburg, one avatar per panel line, and the status word ("Done", "Cancelled", "Did not happen", "Waiting on {n} feedback" counting guests, nothing before the start or with nobody waiting); the count line "1 of 3 required interviews done"', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    const errors = watchErrors(page);
    const list = bonganiList();
    interviews!.set(BONGANI, list, { done: 1, total: 3 });
    await asRecruiter(fx);
    await openAt(page, BONGANI);
    await chooseInterviews(page);
    await interviewsDrawn(page);
    await quiet(page);
    const rows = await readRows(page);
    expect(rows.map((r) => r.text), 'seven rows').toHaveLength(list.length);
    for (const [i, x] of list.entries()) {
      expect(leftover(rows[i]!.text, rowParts(x)), `row ${i + 1} (${x.id}) shows exactly ${JSON.stringify(rowParts(x).filter(Boolean))}`).toBe('');
      expect(rows[i]!.avatars, `row ${i + 1}: one avatar per panel line (guests included)`).toBe(x.panel.length);
    }
    // The words the rows must use, said once more so a wrong order or a missing guest cannot hide.
    expect(rows.map((r) => r.text.includes(IW.done))).toEqual([true, false, false, false, false, false, false]);
    expect(rows[3]!.text).toContain(waitingOn(2));
    expect(rows[5]!.text).toContain('Panel review');
    await expect(main(page).getByText(countLine(1, 3), { exact: true })).toBeVisible();
    await expect(main(page).getByText(/required interviews done/)).toHaveCount(1);
    expect(await main(page).innerText()).not.toMatch(BAD_WORDS);
    expect(errors, 'no console error').toEqual([]);
  });

  test('AC-1 The count line follows `required`: "0 of 2 required interviews done" when it says so; no count line and no words for it when `required` is null', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    interviews!.set(TENDAI, [iv('iv-t1', sast(21, 9), 'SCHEDULED', { type: 'PHONE_SCREEN', panel: [person('Sipho Ndlovu', 'WAITING')] })], { done: 0, total: 2 });
    interviews!.set(AMAHLE, [iv('iv-a1', sast(21, 9), 'SCHEDULED', { type: 'PHONE_SCREEN', panel: [person('Sipho Ndlovu', 'WAITING')] })], null);
    await asRecruiter(fx);
    await openAt(page, TENDAI);
    await chooseInterviews(page);
    await interviewsDrawn(page);
    await expect(main(page).getByText(countLine(0, 2), { exact: true })).toBeVisible();
    await openAt(page, AMAHLE);
    await chooseInterviews(page);
    await interviewsDrawn(page);
    await quiet(page);
    expect(await readRows(page)).toHaveLength(1);
    await expect(main(page).getByText(/required interviews/)).toHaveCount(0);
    expect(await main(page).innerText()).not.toMatch(BAD_WORDS);
  });

  test.describe('with the browser in UTC', () => {
    test.use({ timezoneId: 'UTC' });

    test('AC-1 With the browser in UTC, an interview at 22:30 UTC on 18 Nov shows "19 Nov 2026" and "00:30" (Johannesburg), on its row and when chosen', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
      const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
      const { page, interviews } = fx;
      const at = iso(Date.UTC(2026, 10, 18, 22, 30));
      interviews!.set(BONGANI, [iv('iv-utc', at, 'COMPLETED', { type: 'FINAL', panel: [voted('Sipho Ndlovu', 'YES', 4)] })], { done: 1, total: 3 });
      await asRecruiter(fx);
      await openAt(page, BONGANI);
      await chooseInterviews(page);
      await interviewsDrawn(page);
      const [row] = await readRows(page);
      expect(leftover(row!.text, ['Final', '19 Nov 2026', '00:30', IW.done])).toBe('');
      const c = await readChosen(page);
      expect(c.text).toContain('19 Nov 2026');
      expect(c.text).toContain('00:30');
      expect(c.text).not.toContain('18 Nov 2026');
      expect(c.text).not.toContain('22:30');
    });
  });
});

// ================================================================ AC-2 Chosen interview (M-2, S-2 to S-6)
test.describe('AC-2 Chosen interview', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2 A done interview (marked as done): type as its title, day, time, "60 minutes", "In person" and the place, the status and the Mark-as-done reason; one line per panel entry, in order, with exactly the name and its feedback words: "Yes · 4 out of 5", "Captured by … for …" with "No · 3.7 out of 5", "3 out of 5", "Strong yes", a name alone, "Guest" beside a named guest, "No feedback"; no role and nothing else', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    const panel: Array<[Entry, Array<string | null>]> = [
      [voted('Sipho Ndlovu', 'YES', 4), ['Sipho Ndlovu', 'Yes · 4 out of 5']],
      [voted('Lerato Mokoena', 'NO', 3.7, 'Thandeka Dlamini'), ['Lerato Mokoena', capturedBy('Thandeka Dlamini', 'Lerato Mokoena'), 'No · 3.7 out of 5']],
      [voted(L_THABO, null, 3), [L_THABO, '3 out of 5']],
      [voted('Ayanda Mkhize', 'STRONG_YES', null), ['Ayanda Mkhize', 'Strong yes']],
      [person('Precious Mwale', 'GIVEN'), ['Precious Mwale']],
      [guest('Naledi Khumalo', 'GIVEN'), ['Naledi Khumalo', IW.guest]],
      [person('Farai Chikwanha', 'WAITING', { no_feedback: true }), ['Farai Chikwanha', IW.noFeedback]],
    ];
    const x = iv('iv-done', sast(12, 10), 'COMPLETED', { type: 'TECHNICAL', closed_reason: 'PANEL_MEMBER_CANNOT_GIVE_FEEDBACK', panel: panel.map(([e]) => e) });
    interviews!.set(BONGANI, [x], { done: 1, total: 3 });
    await asRecruiter(fx);
    await openAt(page, BONGANI);
    await chooseInterviews(page);
    await interviewsDrawn(page);
    const c = await readChosen(page);
    expect(c.title, 'the type words are the chosen interview\'s title').toBe('Technical');
    for (const w of [sastDay(x.at!), sastTime(x.at!), IW.inPerson, DEFAULT_PLACE, IW.done, 'Someone on the panel cannot give feedback']) expect(c.text, w).toContain(w);
    expect(c.text, 'the length').toMatch(/\b60 minutes\b|Length\s*60\b/);
    expect(c.people.map((p) => p.text), 'one line per panel entry').toHaveLength(panel.length);
    for (const [i, [, parts]] of panel.entries()) expect(leftover(c.people[i]!.text, parts), `line ${i + 1} shows exactly ${JSON.stringify(parts)}`).toBe('');
    // S-4: the raw votes (rating STRONG_NO, a comment) are never drawn; the per-person words come from panel[].vote only.
    expect(c.text).not.toContain('Strong no');
    expect(await page.content()).not.toContain(NEVER.comment);
    expect(c.text).not.toMatch(BAD_WORDS);
    expect(c.text, 'whole numbers have no decimal').not.toContain('4.0');
  });

  test('AC-2 A booked interview past its start: "Overdue by 2 days", "Overdue by 1 day" and "Overdue" (due earlier today) in a time element on waiting lines whose due time passed; nothing on a line not yet due, with no due time, or with feedback given; a guest with no name shows "Guest" only, with its email when sent; the status "Waiting on 7 feedback". Before an interview starts, no line says anything, even with a due time in the past', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    const due2 = sast(17, 12), due1 = sast(18, 9), due0 = sast(19, 8), later = sast(20, 10);
    const panel: Array<[Entry, Array<string | null>, string | null]> = [
      [person('Sipho Ndlovu', 'WAITING', { due_at: due2 }), ['Sipho Ndlovu', 'Overdue by 2 days'], 'Overdue by 2 days'],
      [person('Lerato Mokoena', 'WAITING', { due_at: due1 }), ['Lerato Mokoena', 'Overdue by 1 day'], 'Overdue by 1 day'],
      [person(L_THABO, 'WAITING', { due_at: due0 }), [L_THABO, 'Overdue'], 'Overdue'],
      [person('Ayanda Mkhize', 'WAITING', { due_at: later }), ['Ayanda Mkhize'], null],
      [person('Precious Mwale', 'WAITING', { due_at: null }), ['Precious Mwale'], null],
      [guest(null, 'WAITING'), [IW.guest], null],
      [guest(null, 'WAITING', { email: 'naledi@fleetwise.co.za' }), [IW.guest, 'naledi@fleetwise.co.za'], null],
      [voted('Farai Chikwanha', 'YES', 4, null, { due_at: due2 }), ['Farai Chikwanha', 'Yes · 4 out of 5'], null],
    ];
    // Checked against the D8 counting rule, so the expected words above cannot drift from it.
    expect([overdueWords(due2, NOW), overdueWords(due1, NOW), overdueWords(due0, NOW)]).toEqual(['Overdue by 2 days', 'Overdue by 1 day', 'Overdue']);
    const past = iv('iv-past', sast(16, 12), 'SCHEDULED', { type: 'CULTURE_FIT', panel: panel.map(([e]) => e) });
    const future = iv('iv-future', sast(21, 9), 'SCHEDULED', { type: 'FINAL', panel: [person('Sipho Ndlovu', 'WAITING', { due_at: sast(18, 9) }), guest(null, 'WAITING')] });
    interviews!.set(BONGANI, [past, future], { done: 1, total: 3 });
    await asRecruiter(fx);
    await openAt(page, BONGANI);
    await chooseInterviews(page);
    await interviewsDrawn(page);
    await choose(page, 0);
    const c = await readChosen(page);
    expect(c.text).toContain(waitingOn(7));
    expect(c.people).toHaveLength(panel.length);
    for (const [i, [, parts, overdue]] of panel.entries()) {
      expect(leftover(c.people[i]!.text, parts), `line ${i + 1} shows exactly ${JSON.stringify(parts)}`).toBe('');
      if (overdue) expect(c.people[i]!.times, `line ${i + 1}: the overdue words are a time element`).toContain(overdue);
    }
    // The booked one that has not started: no status word on its row, nothing on its lines.
    await choose(page, 1);
    const f = await readChosen(page);
    expect(leftover(f.people[0]!.text, ['Sipho Ndlovu']), 'not started: nothing beside the name').toBe('');
    expect(leftover(f.people[1]!.text, [IW.guest])).toBe('');
    expect(f.text).not.toMatch(/Overdue|Waiting on/);
    expect((await readRows(page))[1]!.text).not.toMatch(/Overdue|Waiting on/);
  });

  test('AC-2 Where: an online interview\'s https and http video links are links that open in a new tab with rel "noopener noreferrer" beside "Online"; a javascript: link from a broken answer is shown as plain text, never as a link', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    const links = ['https://meet.example.test/fleet-controller-final', 'http://meet.example.test/plain-http', 'javascript:alert(document.domain)'];
    interviews!.set(BONGANI, links.map((l, i) => iv(`iv-online-${i}`, sast(21 + i, 9), 'SCHEDULED', { where: 'ONLINE', place: null, video_link: l, panel: [person('Sipho Ndlovu', 'WAITING')] })), { done: 1, total: 3 });
    await asRecruiter(fx);
    await openAt(page, BONGANI);
    await chooseInterviews(page);
    await interviewsDrawn(page);
    for (const [i, l] of links.entries()) {
      await choose(page, i);
      const c = await readChosen(page);
      expect(c.text, `${l}: "Online"`).toContain(IW.online);
      expect(c.text).not.toContain(IW.inPerson);
      if (l.startsWith('javascript:')) {
        expect(c.links.filter((a) => a.href.includes('javascript') || a.text.includes('javascript')), 'a javascript: address is not a link').toEqual([]);
        expect(c.text, 'it is shown as plain text').toContain(l);
      } else {
        const a = c.links.filter((x) => x.href === l);
        expect(a, `${l} is one link`).toHaveLength(1);
        expect(a[0]!.target).toBe('_blank');
        expect((a[0]!.rel ?? '').split(/\s+/).sort()).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
      }
    }
    await expect(page.locator('a[href^="javascript" i]')).toHaveCount(0);
  });

  test('AC-2 The closed reason by code and status: each of the ten approved reason words shows on its own interview; an unknown code, a code from another status\'s list, a missing code, and a done interview closed by feedback show no reason; `closed_note` shows as plain text under the reason, never as HTML', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    const NOTE = '<b>MARK-closed-note</b> the candidate phoned at 08:10';
    const cases: Array<[Iv['status'], string | null, string | null]> = [
      ...Object.entries(REASON_WORDS).flatMap(([s, m]) => Object.entries(m).map(([code, words]) => [s as Iv['status'], code, words] as [Iv['status'], string, string])),
      ['CANCELLED', 'MARK_UNKNOWN_REASON', null],
      ['CANCELLED', 'CANDIDATE_DID_NOT_COME', null],
      ['DID_NOT_HAPPEN', 'CANDIDATE_ASKED', null],
      ['COMPLETED', 'CANDIDATE_WITHDREW', null],
      ['DID_NOT_HAPPEN', null, null],
      ['COMPLETED', null, null],
    ];
    const list = cases.map(([s, code], i) => iv(`iv-r${i}`, iso(Date.UTC(2026, 9, 1 + i, 8)), s, {
      closed_reason: code, panel: [voted('Sipho Ndlovu', 'YES', 4)], ...(i === 0 ? { closed_note: NOTE } : {}),
    }));
    interviews!.set(BONGANI, list, { done: 1, total: 3 });
    await asRecruiter(fx);
    await openAt(page, BONGANI);
    await chooseInterviews(page);
    await interviewsDrawn(page);
    for (const [i, [s, code, words]] of cases.entries()) {
      await choose(page, i);
      const c = await readChosen(page);
      const others = ALL_REASON_WORDS.filter((w) => w !== words);
      if (words) expect(c.text, `${s} ${code}: "${words}"`).toContain(words);
      expect(others.filter((w) => new RegExp(`\\b${w}\\b`).test(c.text)), `${s} ${code}: no other reason words`).toEqual([]);
      if (i === 0) {
        expect(c.text, 'the closing note as text').toContain(NOTE);
        await expect(chosenOf(page).locator('b')).toHaveCount(0);
      }
    }
  });

  test('AC-2 Missing parts are left out: no type, no time, no status, no length, no place and no link show nothing for those parts, and no "null", "undefined", "NaN" or "Invalid Date" anywhere', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    const list = [
      iv('iv-n1', null, null, { type: null, length_minutes: null, where: null, place: null, video_link: null, sequence: null, panel: [person('Sipho Ndlovu', 'WAITING')] }),
      iv('iv-n2', sast(2, 10), 'COMPLETED', { type: '', length_minutes: 45, where: 'IN_PERSON', place: null, panel: [voted('Sipho Ndlovu', 'YES', 4)] }),
      iv('iv-n3', sast(4, 10), 'COMPLETED', { where: 'ONLINE', place: null, video_link: null, length_minutes: null, panel: [voted('Sipho Ndlovu', 'YES', 4)] }),
    ];
    interviews!.set(BONGANI, list, { done: 1, total: 3 });
    await asRecruiter(fx);
    await openAt(page, BONGANI);
    await chooseInterviews(page);
    await interviewsDrawn(page);
    const rows = await readRows(page);
    expect(rows).toHaveLength(3);
    expect(leftover(rows[0]!.text, []), 'a row with nothing known shows no words').toBe('');
    expect(leftover(rows[1]!.text, [sastDay(list[1]!.at!), sastTime(list[1]!.at!), IW.done]), 'an empty type shows nothing').toBe('');
    for (const i of [0, 1, 2]) {
      await choose(page, i);
      const c = await readChosen(page);
      expect(c.text, `interview ${i + 1}`).not.toMatch(BAD_WORDS);
      if (i !== 1) expect(c.text, 'no length: no minutes').not.toMatch(/minutes|Length/);
      if (i === 0) expect(c.title, 'no type: no title words').toBe('');
      if (i === 1) { expect(c.text).toMatch(/\b45 minutes\b|Length\s*45\b/); expect(c.text).toContain(IW.inPerson); }
      if (i === 2) { expect(c.text).toContain(IW.online); expect(c.links).toEqual([]); }
    }
    expect(await main(page).innerText()).not.toMatch(BAD_WORDS);
  });

  test('AC-2 Never drawn: the raw votes[] (its comment, rating and voter), person ids, closed_by_name, closed_at, and the stale old fields (interviewType, scheduledAt, adhocPanelMembers, criteria labels) never reach the page, the tab title or an attribute, whichever interview is chosen', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    const list = bonganiList();
    interviews!.set(BONGANI, list, { done: 1, total: 3 });
    await asRecruiter(fx);
    await openAt(page, BONGANI);
    await chooseInterviews(page);
    await interviewsDrawn(page);
    const marks = [NEVER.comment, NEVER.voterId, NEVER.personId, NEVER.closedBy, NEVER.staleType, NEVER.staleTypeWords, NEVER.adhocName, NEVER.adhocEmail, NEVER.adhocRole, NEVER.criteria, NEVER_DAY, '2025-03-03'];
    for (let i = 0; i < list.length; i++) {
      await choose(page, i);
      const all = `${await page.content()} ${await page.title()}`;
      expect(marks.filter((m) => all.includes(m)), `interview ${i + 1}: nothing that is never drawn`).toEqual([]);
      expect((await readChosen(page)).text, `interview ${i + 1}: the raw vote's rating`).not.toContain('Strong no');
    }
  });
});

// ================================================================ AC-3 No actions (M-4)
test.describe('AC-3 No actions', () => {
  test.beforeEach(noBackendOnly);

  test('AC-3 With the four flags off, for every `can` mix the fake sends (all true, all false, each key alone true) on interviews in every status, no "Schedule an interview", "Reschedule" or "Add panel member" shows anywhere: tab header, list or chosen interview', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    const mixes = [canOf('all'), canOf('none'), ...CAN_KEYS.map((k) => canOf({ [k]: true }))];
    const kinds: Array<[Iv['status'], number]> = [['COMPLETED', -20], ['CANCELLED', -15], ['DID_NOT_HAPPEN', -10], ['SCHEDULED', -2], ['SCHEDULED', 3]];
    const list: Iv[] = [];
    kinds.forEach(([s, d], k) => mixes.forEach((can, m) => list.push(iv(`iv-c${k}-${m}`, iso(NOW + d * DAY + (k * 10 + m) * HOUR), s, {
      can, closed_reason: s === 'CANCELLED' ? 'CANDIDATE_ASKED' : s === 'DID_NOT_HAPPEN' ? 'OTHER' : null,
      panel: [person('Sipho Ndlovu', 'WAITING', { due_at: iso(NOW - DAY) }), guest(null, 'WAITING')],
    }))));
    list.sort((a, b) => a.at!.localeCompare(b.at!));
    interviews!.set(BONGANI, list, { done: 1, total: 3 });
    await asRecruiter(fx);
    await openAt(page, BONGANI);
    await chooseInterviews(page);
    await interviewsDrawn(page);
    expect(await readRows(page)).toHaveLength(list.length);
    await noActions(page, 'the tab as it opens');
    for (let i = 0; i < list.length; i++) {
      await choose(page, i);
      await noActions(page, `${list[i]!.id} (${list[i]!.status}, ${JSON.stringify(list[i]!.can)})`);
    }
  });

  test('AC-3 No action shows in the empty state or the failure state either', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    interviews!.set(TENDAI, [], { done: 0, total: 2 });
    await asRecruiter(fx);
    await openAt(page, TENDAI);
    await chooseInterviews(page);
    await expect(main(page).getByText(IW.empty, { exact: true })).toBeVisible();
    await noActions(page, 'the empty state');
    interviews!.refuse({ status: 500, id: BONGANI });
    await openAt(page, BONGANI);
    await chooseInterviews(page);
    await expect(main(page).getByText(IW.failed, { exact: true })).toBeVisible();
    const found = (await controls(page)).filter((c) => ACTION_WORDS.some((w) => c.includes(w)));
    expect(found, 'the failure state: only "Try again"').toEqual([]);
  });
});

// ================================================================ AC-4 Recruiter fields (M-1)
test.describe('AC-4 Recruiter fields', () => {
  test.beforeEach(noBackendOnly);

  test('AC-4 When the answer sends them, the guest\'s email, `candidate_note` under "Note for the candidate" and `closed_note` show (as text); when it leaves them out, or sends them null, none of them and no "Note for the candidate" label shows', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    const EMAIL = 'naledi@fleetwise.co.za', NOTE = 'Bring your ID book to reception <i>please</i>', CLOSED = 'Asked to move it to next week';
    const base = (id: string, extra: Partial<Iv>, guestExtra: Partial<Entry>) => iv(id, sast(14, 10), 'CANCELLED', {
      closed_reason: 'CANDIDATE_ASKED', panel: [person('Sipho Ndlovu', 'WAITING'), guest(null, 'WAITING', guestExtra)], ...extra,
    });
    interviews!.set(BONGANI, [base('iv-f1', { candidate_note: NOTE, closed_note: CLOSED }, { email: EMAIL })], { done: 1, total: 3 });
    interviews!.set(TENDAI, [base('iv-f2', {}, {})], { done: 0, total: 2 });
    interviews!.set(PULE, [base('iv-f3', { candidate_note: null, closed_note: null }, { email: null })], { done: 0, total: 2 });
    await asRecruiter(fx);
    await openAt(page, BONGANI);
    await chooseInterviews(page);
    await interviewsDrawn(page);
    const c = await readChosen(page);
    for (const w of [EMAIL, IW.noteLabel, NOTE, CLOSED, 'Candidate asked']) expect(c.text, w).toContain(w);
    await expect(chosenOf(page).locator('i')).toHaveCount(0);
    expect(leftover(c.people[1]!.text, [IW.guest, EMAIL])).toBe('');
    for (const id of [TENDAI, PULE]) {
      await openAt(page, id);
      await chooseInterviews(page);
      await interviewsDrawn(page);
      const d = await readChosen(page);
      for (const w of [EMAIL, IW.noteLabel, NOTE, CLOSED]) expect(d.text, `${id}: ${w}`).not.toContain(w);
      expect(d.text, id).toContain('Candidate asked');
      expect(leftover(d.people[1]!.text, [IW.guest]), `${id}: the guest line`).toBe('');
      expect(d.text, id).not.toMatch(BAD_WORDS);
    }
  });
});

// ================================================================ AC-5 Words table (M-5)
test.describe('AC-5 Words table', () => {
  test.beforeEach(noBackendOnly);

  test('AC-5 No gap marker "⟦" shows in any state the tab draws: each interview chosen, the empty list, the failure line', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    const list = bonganiList();
    interviews!.set(BONGANI, list, { done: 1, total: 3 });
    interviews!.set(TENDAI, [], { done: 0, total: 2 });
    await asRecruiter(fx);
    await openAt(page, BONGANI);
    await chooseInterviews(page);
    await interviewsDrawn(page);
    for (let i = 0; i < list.length; i++) {
      await choose(page, i);
      expect(await page.content(), `interview ${i + 1}`).not.toContain('⟦');
    }
    await openAt(page, TENDAI);
    await chooseInterviews(page);
    await expect(main(page).getByText(IW.empty, { exact: true })).toBeVisible();
    expect(await page.content(), 'the empty list').not.toContain('⟦');
    interviews!.refuse({ status: 500, id: AMAHLE });
    await openAt(page, AMAHLE);
    await chooseInterviews(page);
    await expect(main(page).getByText(IW.failed, { exact: true })).toBeVisible();
    expect(await page.content(), 'the failure line').not.toContain('⟦');
  });

  test('AC-5 The words table check: the hygiene job runs scripts/ci/check-interview-words.mjs; it passes on interview-words.ts and on an exact copy of it, and fails when one row\'s words ("Cancelled") are planted as null, and again as \'\'', async () => {
    desktopOnly('it checks files, not the page');
    const repo = join(__dirname, '..', '..', '..');
    const script = join(repo, 'scripts', 'ci', 'check-interview-words.mjs');
    const words = join(repo, 'pepla-web', 'src', 'app', 'features', 'recruitment', 'interviews', 'interview-words.ts');
    const ci = readFileSync(join(repo, '.github', 'workflows', 'ci.yml'), 'utf8');
    const hygiene = /\n {2}hygiene:\n([\s\S]*?)(?=\n {2}[\w-]+:\n|$)/.exec(ci)?.[1] ?? '';
    expect(hygiene, 'the hygiene job runs the words table check').toMatch(/node\s+(\.\/)?scripts\/ci\/check-interview-words\.mjs/);
    const run = (args: string[]): number => {
      try { execFileSync('node', [script, ...args], { cwd: repo, stdio: 'pipe' }); return 0; } catch (e) { return (e as { status?: number }).status ?? 1; }
    };
    expect(run([]), 'the check passes on the real table').toBe(0);
    const text = readFileSync(words, 'utf8');
    const m = /(['"`])Cancelled\1/.exec(text);
    expect(m, 'the table holds "Cancelled" as a string').toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), 'int-ui-01-'));
    try {
      const copy = join(dir, 'interview-words.ts');
      writeFileSync(copy, text);
      expect(run([copy]), 'the check passes on an exact copy given as its argument').toBe(0);
      writeFileSync(copy, text.replace(m![0], 'null'));
      expect(run([copy]), 'a planted null row fails the check').not.toBe(0);
      writeFileSync(copy, text.replace(m![0], "''"));
      expect(run([copy]), 'a planted empty row fails the check').not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ================================================================ AC-6 Address (M-6, N-1)
test.describe('AC-6 Address', () => {
  test.beforeEach(noBackendOnly);

  test('AC-6 ?tab=interviews&interview=<id> opens that interview and it survives a reload; choosing an interview and a tab writes the address with no new history entry (Back leaves the record); leaving the tab drops `interview`', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    const list = bonganiList();
    interviews!.set(BONGANI, list, { done: 1, total: 3 });
    await asRecruiter(fx);
    await openAt(page, BONGANI, '?tab=interviews&interview=iv-2');
    await expect(tab(page, IW.tab)).toHaveAttribute('aria-selected', 'true');
    await interviewsDrawn(page);
    await expect.poll(async () => (await readRows(page)).findIndex((r) => r.selected)).toBe(1);
    expect((await readChosen(page)).title).toBe('Technical');
    const entries = await page.evaluate(() => history.length);
    await choose(page, 2);
    await expect(page).toHaveURL(/[?&]interview=iv-3(&|$)/);
    await expect(page).toHaveURL(/[?&]tab=interviews(&|$)/);
    expect(await page.evaluate(() => history.length), 'choosing an interview adds no history entry').toBe(entries);
    await page.reload();
    await expect(tab(page, IW.tab)).toHaveAttribute('aria-selected', 'true');
    await interviewsDrawn(page);
    await expect.poll(async () => (await readRows(page)).findIndex((r) => r.selected), { message: 'the chosen interview survives a reload' }).toBe(2);
    expect((await readChosen(page)).title).toBe('Behavioral');
    await tab(page, IW.overview).click();
    await expect(page).toHaveURL(/[?&]tab=overview(&|$)/);
    expect(new URL(page.url()).searchParams.has('interview'), 'leaving the tab drops `interview`').toBe(false);
    await chooseInterviews(page);
    await expect(page).toHaveURL(/[?&]tab=interviews(&|$)/);
    expect(await page.evaluate(() => history.length), 'choosing tabs adds no history entry').toBe(entries);
    await page.goBack();
    await expect(page, 'Back leaves the record').toHaveURL('/hr');
  });

  test('AC-6 An unknown interview id, or none, chooses the newest open interview (the last booked one in answer order) and the address names it; with none open, the last one; with none at all, the empty state', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    interviews!.set(BONGANI, bonganiList(), { done: 1, total: 3 });
    const closed = [iv('iv-k1', sast(2, 9), 'COMPLETED', { type: 'PHONE_SCREEN', panel: [voted('Sipho Ndlovu', 'YES', 4)] }), iv('iv-k2', sast(5, 9), 'CANCELLED', { type: 'FINAL', closed_reason: 'OTHER' })];
    interviews!.set(TENDAI, closed, { done: 1, total: 2 });
    interviews!.set(PULE, [], { done: 0, total: 2 });
    await asRecruiter(fx);
    await openAt(page, BONGANI, '?tab=interviews&interview=iv-unknown');
    await interviewsDrawn(page);
    await expect.poll(async () => (await readRows(page)).findIndex((r) => r.selected), { message: 'iv-6, the last booked one, not iv-7 (no status)' }).toBe(5);
    expect((await readChosen(page)).title).toBe('Panel review');
    await expect(page).toHaveURL(/[?&]interview=iv-6(&|$)/);
    await openAt(page, BONGANI, '?tab=interviews');
    await interviewsDrawn(page);
    await expect.poll(async () => (await readRows(page)).findIndex((r) => r.selected)).toBe(5);
    await openAt(page, TENDAI, '?tab=interviews&interview=iv-nope');
    await interviewsDrawn(page);
    await expect.poll(async () => (await readRows(page)).findIndex((r) => r.selected), { message: 'none open: the last one' }).toBe(1);
    expect((await readChosen(page)).title).toBe('Final');
    await openAt(page, PULE, '?tab=interviews&interview=iv-nope');
    await expect(main(page).getByText(IW.empty, { exact: true })).toBeVisible();
    await expect(chosenOf(page)).toHaveCount(0);
  });

  test('AC-6 No `tab`, an unknown `tab`, a tab whose flag is off (offer) and `tab=overview` all open Overview and read no interviews; an address with no `tab` stays exactly the record\'s address (N-1)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    interviews!.set(BONGANI, bonganiList(), { done: 1, total: 3 });
    await asRecruiter(fx);
    for (const q of ['', '?tab=bogus', '?tab=offer', '?tab=overview', '?tab=overview&interview=iv-2', '?interview=iv-2']) {
      await openAt(page, BONGANI, q);
      await quiet(page);
      await expect(tab(page, IW.overview), `${q || 'no query'}: Overview`).toHaveAttribute('aria-selected', 'true');
      await expect(tab(page, IW.tab)).not.toHaveAttribute('aria-selected', 'true');
      await expect(detailsCard(page)).toBeVisible();
      await expect(rowsOf(page)).toHaveCount(0);
      if (q === '') expect(new URL(page.url()).pathname + new URL(page.url()).search, 'the address is left alone').toBe(`/hire/candidates/${BONGANI}`);
    }
    expect(interviews!.reads(), 'no interviews read on Overview').toHaveLength(0);
  });

  test('AC-6 Switching candidate in the same tab with no reload: the new address opens on Overview, its Interviews read is that candidate\'s, and a held answer for the first candidate drawn after the switch shows nothing', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    interviews!.set(BONGANI, [iv('iv-b1', sast(17, 10), 'SCHEDULED', { type: 'NIGHT_SHIFT_WALKTHROUGH', place: 'Bongani-only depot yard', panel: [person('Nompumelelo Vilakazi', 'WAITING')] })], { done: 1, total: 3 });
    interviews!.set(TENDAI, [iv('iv-t1', sast(20, 9), 'SCHEDULED', { type: 'FINAL', panel: [person('Sipho Ndlovu', 'WAITING')] })], { done: 1, total: 2 });
    const aWords = ['Night shift walkthrough', 'Bongani-only depot yard', 'Nompumelelo Vilakazi'];
    await asRecruiter(fx);
    await openAt(page, BONGANI, '?tab=interviews');
    await interviewsDrawn(page);
    expect((await readChosen(page)).title).toBe('Night shift walkthrough');
    await inApp(page, `/hire/candidates/${TENDAI}`);
    await expect.poll(async () => (await personHeader(page).count()) && (await readHeader(page)).name).toBe('Tendai Ncube');
    await expect(tab(page, IW.overview), 'the new address opens on Overview').toHaveAttribute('aria-selected', 'true');
    await quiet(page);
    const html = await page.content();
    for (const w of aWords) expect(html, w).not.toContain(w);
    await chooseInterviews(page);
    await interviewsDrawn(page);
    expect((await readChosen(page)).title).toBe('Final');
    expect(interviews!.reads(TENDAI)).toHaveLength(1);
    // Back to Bongani's interviews with the answer held, then to Tendai's record before it comes.
    interviews!.refuse({ hold: true, id: BONGANI });
    await inApp(page, `/hire/candidates/${BONGANI}?tab=interviews`);
    await expect.poll(() => interviews!.heldCount).toBe(1);
    await inApp(page, `/hire/candidates/${TENDAI}?tab=interviews`);
    await expect.poll(async () => (await personHeader(page).count()) && (await readHeader(page)).name).toBe('Tendai Ncube');
    await interviewsDrawn(page);
    interviews!.release();
    await quiet(page);
    const after = await page.content();
    for (const w of aWords) expect(after, `the late answer draws nothing: ${w}`).not.toContain(w);
    expect((await readChosen(page)).title).toBe('Final');
    expect(await readRows(page)).toHaveLength(1);
  });
});

// ================================================================ AC-7 Failure and empty (rule 8 settled, S-7)
test.describe('AC-7 Failure and empty', () => {
  test.beforeEach(noBackendOnly);

  test('AC-7 No read until Interviews is chosen; while it reads, pp-skeleton shows in the tab; it reads once (also when chosen again after Overview), with the record\'s sign-in header and nothing in the query; an address that opens on the tab reads once', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, record, interviews } = fx;
    interviews!.set(BONGANI, bonganiList(), { done: 1, total: 3 });
    await asRecruiter(fx);
    await openAt(page, BONGANI);
    await quiet(page);
    expect(interviews!.reads(), 'no read on Overview').toHaveLength(0);
    interviews!.refuse({ hold: true });
    await tab(page, IW.tab).click();
    await expect.poll(() => interviews!.heldCount).toBe(1);
    const region = await interviewsRegion(page);
    await expect(region, 'one region labelled by the Interviews tab').toHaveCount(1);
    await expect(region.locator('.pp-skeleton').first(), 'the loading look').toBeVisible();
    await expect(rowsOf(page)).toHaveCount(0);
    interviews!.release();
    await interviewsDrawn(page);
    await expect(region.locator(`:is(ul, ol)[aria-label="Interviews"]`)).toHaveCount(1);
    expect(await readRows(page)).toHaveLength(7);
    await expect(nextStepCard(page), 'the Overview cards are not shown while Interviews is chosen').toBeHidden();
    await tab(page, IW.overview).click();
    await expect(detailsCard(page)).toBeVisible();
    await chooseInterviews(page);
    await interviewsDrawn(page);
    await quiet(page);
    expect(interviews!.reads(BONGANI), 'one read for this candidate').toHaveLength(1);
    const call = interviews!.reads(BONGANI)[0]!;
    expect(call.authorization).toBe(record!.reads(BONGANI).at(-1)!.authorization);
    expect(call.query, 'nothing in the query').toEqual({});
    await openAt(page, TENDAI, '?tab=interviews');
    await interviewsDrawn(page);
    await quiet(page);
    expect(interviews!.reads(TENDAI), 'an address on the tab reads once').toHaveLength(1);
  });

  for (const [label, refusal] of [['A 500', { status: 500 }], ['A dropped connection', { abort: true }]] as const) {
    test(`AC-7 ${label} shows "Interviews could not be loaded." with "Try again" and no row; "Try again" reads exactly once more and draws the interviews`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
      const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
      const { page, interviews } = fx;
      interviews!.set(BONGANI, bonganiList(), { done: 1, total: 3 });
      await asRecruiter(fx);
      await openAt(page, BONGANI);
      interviews!.refuse({ ...refusal, id: BONGANI });
      await chooseInterviews(page);
      const region = await interviewsRegion(page);
      await expect(region.getByText(IW.failed, { exact: true })).toBeVisible();
      await expect(rowsOf(page)).toHaveCount(0);
      await expect(chosenOf(page)).toHaveCount(0);
      await expect(main(page).getByText(/required interviews done/)).toHaveCount(0);
      await quiet(page);
      expect(interviews!.reads(BONGANI)).toHaveLength(1);
      await region.getByRole('button', { name: IW.tryAgain, exact: true }).click();
      await interviewsDrawn(page);
      expect(await readRows(page)).toHaveLength(7);
      await expect(main(page).getByText(IW.failed, { exact: true })).toHaveCount(0);
      await quiet(page);
      expect(interviews!.reads(BONGANI), '"Try again" reads exactly once more').toHaveLength(2);
    });
  }

  test('AC-7 An empty list shows "No interviews yet." and no row and no chosen interview', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    interviews!.set(TENDAI, [], { done: 0, total: 2 });
    await asRecruiter(fx);
    await openAt(page, TENDAI);
    await chooseInterviews(page);
    const region = await interviewsRegion(page);
    await expect(region.getByText(IW.empty, { exact: true })).toBeVisible();
    await quiet(page);
    await expect(rowsOf(page)).toHaveCount(0);
    await expect(chosenOf(page)).toHaveCount(0);
    expect(await main(page).innerText()).not.toMatch(BAD_WORDS);
  });
});

// ================================================================ AC-8 Company B (tenancy, safety)
test.describe('AC-8 Company B', () => {
  test.beforeEach(noBackendOnly);

  test('AC-8 A company B Recruiter (Recruitment on) opening company A\'s candidate at ?tab=interviews sees only "This candidate could not be found.", no tab, and A\'s interviews are never asked for; B\'s own candidate\'s interviews show; the fake refuses B a read of A\'s interviews with 404', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, modules, interviews } = fx;
    interviews!.set(BONGANI, [iv('iv-a1', sast(17, 10), 'SCHEDULED', { type: 'NIGHT_SHIFT_WALKTHROUGH', place: 'Bongani-only depot yard', panel: [person('Nompumelelo Vilakazi', 'WAITING')] })], { done: 1, total: 3 });
    interviews!.set('cand-b2', [iv('iv-b2', sast(20, 9), 'SCHEDULED', { type: 'FINAL', place: 'Dispatch office', panel: [person('Lindiwe Peters', 'WAITING')] })], { done: 1, total: 2 });
    modules!.answers.B = ['onboarding', 'recruitment'];
    await asRecruiter(fx, WHO.recruiterB);
    for (const q of ['?tab=interviews', '?tab=interviews&interview=iv-a1', '']) {
      await openAt(page, BONGANI, q);
      await expect(main(page).getByText(IW.notFound, { exact: true })).toBeVisible();
      await quiet(page);
      await expect(main(page).getByRole('tab')).toHaveCount(0);
      expect(interviews!.requests, `${q}: A's interviews are never asked for`).toHaveLength(0);
      const html = await page.content();
      for (const n of ['Night shift walkthrough', 'Bongani-only depot yard', 'Nompumelelo Vilakazi', 'Bongani']) expect(html, `${q}: ${n}`).not.toContain(n);
    }
    // Control: B's own candidate.
    await openAt(page, 'cand-b2', '?tab=interviews');
    await interviewsDrawn(page);
    expect((await readChosen(page)).title).toBe('Final');
    expect(interviews!.reads().map((c) => [c.email, c.status])).toEqual([[WHO.recruiterB.email, 200]]);
    // The fake answers B's sign-in on A's candidate as ownsRow does: 404, nothing of A.
    const auth = interviews!.reads('cand-b2')[0]!.authorization!;
    const url = interviews!.urls[0]!.replace('/cand-b2/', `/${BONGANI}/`);
    const answer = await page.evaluate(async ([u, a]) => { const r = await fetch(u!, { headers: { Authorization: a! } }); return { status: r.status, body: await r.text() }; }, [url, auth]);
    expect(answer.status).toBe(404);
    expect(answer.body).not.toContain('Nompumelelo');
  });

  test('AC-8 A\'s Recruiter, on A\'s Interviews tab, signs out with the app\'s Sign out; B\'s Recruiter signs in on the page the app left (no reload): no A interview, name, type or place shows at any moment, while B\'s answer is on its way, after it, or on A\'s address reached inside the app', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, signIn, cognito, modules, hire, interviews } = fx;
    interviews!.set(BONGANI, [iv('iv-a1', sast(17, 10), 'SCHEDULED', { type: 'NIGHT_SHIFT_WALKTHROUGH', place: 'Bongani-only depot yard', panel: [person('Nompumelelo Vilakazi', 'WAITING')] })], { done: 1, total: 3 });
    interviews!.set('cand-b2', [iv('iv-b2', sast(20, 9), 'SCHEDULED', { type: 'FINAL', place: 'Dispatch office', panel: [person('Lindiwe Peters', 'WAITING')] })], { done: 1, total: 2 });
    const aWords = ['Night shift walkthrough', 'Bongani-only depot yard', 'Nompumelelo Vilakazi', 'Bongani'];
    await asRecruiter(fx);
    await openAt(page, BONGANI, '?tab=interviews');
    await interviewsDrawn(page);
    expect((await readChosen(page)).title).toBe('Night shift walkthrough');
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.evaluate((words) => {
      const seen: string[] = [];
      (window as unknown as { __seenA: string[] }).__seenA = seen;
      const check = () => {
        const all = `${document.documentElement.outerHTML} ${document.title}`;
        for (const w of words) if (all.includes(w)) seen.push(`${w} at ${location.pathname}${location.search}`);
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
    // B's own candidate on the Interviews tab, reached inside the app, with B's answer held.
    interviews!.refuse({ hold: true, id: 'cand-b2' });
    await inApp(page, '/hire/candidates/cand-b2?tab=interviews');
    await expect.poll(() => interviews!.heldCount).toBe(1);
    await page.waitForTimeout(500);
    expect(await seenA(), 'nothing of A while B\'s answer is on its way').toEqual([]);
    interviews!.release();
    await interviewsDrawn(page);
    expect((await readChosen(page)).title).toBe('Final');
    expect(await seenA(), 'nothing of A on B\'s tab').toEqual([]);
    // A's address reached inside the app: not found, and no A interview at any moment.
    await inApp(page, `/hire/candidates/${BONGANI}?tab=interviews`);
    await expect(main(page).getByText(IW.notFound, { exact: true })).toBeVisible();
    await quiet(page);
    expect(await seenA(), 'nothing of A at any moment').toEqual([]);
    expect(interviews!.reads(BONGANI).filter((c) => c.email === who.email), 'B never asks for A\'s interviews').toHaveLength(0);
  });

  test('AC-8 No interviews request carries a company: opening the tab, an address on it and "Try again" send only the token and the candidate id', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    interviews!.set(BONGANI, bonganiList(), { done: 1, total: 3 });
    await asRecruiter(fx);
    await openAt(page, BONGANI);
    await chooseInterviews(page);
    await interviewsDrawn(page);
    interviews!.refuse({ status: 500, id: TENDAI });
    await openAt(page, TENDAI, '?tab=interviews');
    await main(page).getByRole('button', { name: IW.tryAgain, exact: true }).click();
    await interviewsDrawn(page);
    await quiet(page);
    const calls = interviews!.reads();
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const c of calls) {
      expect(companyIdIn(c), c.path).toEqual([]);
      expect(c.query, c.path).toEqual({});
      expect(c.path).toMatch(/^\/v1\/candidates\/cand-[a-z0-9-]+\/interviews$/);
    }
  });
});

// ================================================================ AC-9 Phone (390 wide)
test.describe('AC-9 Phone', () => {
  test.beforeEach(noBackendOnly);

  // Runs at 1280 too for the visibility half: standing line 4 asks for covered, clipped or cut-off items at desktop and phone width.
  test('AC-9 At 390 wide (and at 1280) the tab strip, the count line, every row and the chosen interview with its lines are visible, not under the top bar, not covered, not cut off by any box around them; no sideways scroll; at 390 the chosen interview sits below the list', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e, interviews: _i });
    const { page, interviews } = fx;
    const list = bonganiList();
    list[3] = iv('iv-4', sast(17, 10), 'SCHEDULED', {
      type: 'CULTURE_FIT', where: 'ONLINE', place: null, video_link: 'https://meet.example.test/a-rather-long-video-link-for-the-culture-fit-interview-with-bongani',
      panel: [voted('Nompumelelo Vilakazi-Mahlangu', 'NO', 3.7, 'Thandeka Dlamini'), person('Lerato Mokoena', 'WAITING', { due_at: sast(17, 12) }), guest(null, 'WAITING', { email: 'naledi.khumalo-van-der-merwe@fleetwise-logistics.co.za' })],
      candidate_note: 'Please bring your ID book and the signed driver declaration form to reception before ten.',
    });
    interviews!.set(BONGANI, list, { done: 1, total: 3 });
    await asRecruiter(fx);
    await openAt(page, BONGANI, '?tab=interviews&interview=iv-4');
    await interviewsDrawn(page);
    await expect.poll(async () => (await readRows(page)).findIndex((r) => r.selected)).toBe(3);
    await quiet(page);
    const count = countLine(1, 3);
    const problems = await page.evaluate(async ([chosenSel, listSel, countText]) => {
      const out: string[] = [];
      const width = document.documentElement.clientWidth;
      const bar = document.querySelector('pp-top-navigation')?.getBoundingClientRect();
      const countEls = [...document.querySelectorAll<HTMLElement>('main *')].filter((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim() === countText && ![...e.children].some((k) => (k.textContent ?? '').replace(/\s+/g, ' ').trim() === countText));
      if (countEls.length !== 1) out.push(`the count line is found ${countEls.length} times`);
      const chosen = document.querySelector<HTMLElement>(`main ${chosenSel}`);
      if (!chosen) out.push('no chosen interview');
      const targets = [
        ...document.querySelectorAll<HTMLElement>('main [role="tab"]'), ...countEls,
        ...document.querySelectorAll<HTMLElement>(`main :is(${listSel}) > li`),
        ...(chosen ? [chosen, ...chosen.querySelectorAll<HTMLElement>('.pp-card__title, .pp-person, a, time')] : []),
      ];
      for (const el of targets) {
        const clips: Array<[Element, number, number]> = [];
        for (let a = el.parentElement; a; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (/hidden|clip/.test(cs.overflowX + cs.overflowY)) clips.push([a, a.scrollTop, a.scrollLeft]);
        }
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        for (const [a, t, l] of clips) { a.scrollTop = t; a.scrollLeft = l; }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = el.getBoundingClientRect();
        const label = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') { out.push(`${label} is not visible`); continue; }
        if (r.left < -1 || r.right > width + 1) out.push(`${label} is cut off sideways (${Math.round(r.left)} to ${Math.round(r.right)})`);
        if (bar && r.top < bar.bottom - 1 && r.bottom > 0) out.push(`${label} is under the top bar`);
        for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (!/hidden|clip/.test(cs.overflowX + cs.overflowY) && cs.clipPath === 'none') continue;
          const b = a.getBoundingClientRect();
          if (r.top < b.top - 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1 || r.right > b.right + 1) { out.push(`${label} is cut off by ${a.tagName.toLowerCase()}.${String(a.className).split(' ')[0]}`); break; }
        }
        // Covered: a point inside the item (its middle, kept on screen for an item taller than the window) is the item or inside it.
        const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 20), 1), innerHeight - 1);
        const hit = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 1), width - 1), y);
        if (hit && !el.contains(hit) && !hit.contains(el)) out.push(`${label} is covered by ${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}`);
      }
      window.scrollTo(0, 0);
      if (document.documentElement.scrollWidth > width + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide)`);
      return out;
    }, [CHOSEN, LIST, count] as const);
    expect(problems).toEqual([]);
    if (test.info().project.name === 'phone-390') {
      const listBox = await main(page).locator(LIST).first().boundingBox();
      const chosenBox = await chosenOf(page).boundingBox();
      expect(chosenBox!.y, 'at 390 the chosen interview is below the list').toBeGreaterThanOrEqual(listBox!.y + listBox!.height - 1);
    }
  });
});

// ================================================================ AC-10 pepla-dev (judged after merge, M-7)
test.describe('AC-10 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-10 runs on pepla-dev only.');
  type DevIds = { candidate: string; firstName: string; lastName: string; interviews: { booked: string; waiting: string; done: string; cancelled: string }; comment: string };
  const DEV = JSON.parse(readFileSync(join(__dirname, 'support', 'int-ui', 'dev-ids.json'), 'utf8')) as DevIds;

  test('AC-10 @pepla-dev The company A HR login opens the seeded candidate at ?tab=interviews: four rows, one each with "Cancelled", "Done", "Waiting on 1 feedback" and a quiet booked one; each chosen shows its type and day; the cancelled one says "Candidate asked"; the seeded comment never shows', async ({ page, signIn, hr }) => {
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto(`/hire/candidates/${DEV.candidate}?tab=interviews`);
    await expect(personHeader(page)).toBeVisible();
    await expect(tab(page, IW.tab)).toHaveAttribute('aria-selected', 'true');
    await interviewsDrawn(page);
    await expect(main(page).getByText(IW.failed, { exact: true })).toHaveCount(0);
    await expect(main(page).getByText(/^\d+ of \d+ required interviews done$/)).toBeVisible();
    const rows = await readRows(page);
    expect(rows, 'the four seeded interviews').toHaveLength(4);
    const statusOf = (t: string) => (t.includes(IW.cancelled) ? 'cancelled' : t.includes(IW.done) ? 'done' : t.includes(waitingOn(1)) ? 'waiting' : /Waiting on|Did not happen/.test(t) ? 'other' : 'booked');
    expect(rows.map((r) => statusOf(r.text)).sort()).toEqual(['booked', 'cancelled', 'done', 'waiting']);
    for (let i = 0; i < rows.length; i++) {
      await choose(page, i);
      const c = await readChosen(page);
      expect(c.title, `interview ${i + 1}: its type words`).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/);
      expect(c.text).toMatch(/\b\d{1,2} [A-Z][a-z]{2} \d{4}\b/);
      expect(c.text).not.toMatch(BAD_WORDS);
      if (statusOf(rows[i]!.text) === 'cancelled') expect(c.text).toContain('Candidate asked');
      expect(await page.content(), 'the seeded comment').not.toContain(DEV.comment);
    }
    await noActions(page, 'pepla-dev');
    test.info().annotations.push({ type: 'record', description: page.url() });
  });

  test('AC-10 @pepla-dev Company B\'s HR login opening that candidate at ?tab=interviews sees "This candidate could not be found." (Recruitment on) or is sent away (off): no Interviews tab, no interview and no name of A. It fails when E2E_B_HR_* is not set (a skip is not a pass)', async ({ page, signIn }) => {
    const email = process.env['E2E_B_HR_EMAIL'], password = process.env['E2E_B_HR_PASSWORD'];
    expect(email && password, 'E2E_B_HR_EMAIL and E2E_B_HR_PASSWORD must be set on the dev run: the company B half cannot be skipped').toBeTruthy();
    await signIn.open();
    await signIn.signInAs({ email: email!, password: password! });
    await expect(page).toHaveURL('/hr');
    await openNav(page);
    const recruitmentOn = (await navLabels(page)).includes('Candidates');
    await page.goto(`/hire/candidates/${DEV.candidate}?tab=interviews`);
    await quiet(page);
    if (recruitmentOn) await expect(main(page).getByText(IW.notFound, { exact: true })).toBeVisible();
    else await expect(page).toHaveURL('/hr');
    await expect(main(page).getByRole('tab', { name: IW.tab, exact: true })).toHaveCount(0);
    await expect(rowsOf(page)).toHaveCount(0);
    const html = await page.content();
    for (const n of [DEV.lastName, DEV.comment, IW.cancelled, waitingOn(1)]) expect(html).not.toContain(n);
  });
});

