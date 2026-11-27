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
import { personHeader, type RecordFake } from './support/rec-ui-02/record';
import type { EventsFake } from './support/rec-ui-02/notes';
import { CHOSEN, IW, LIST, canOf, chosenOf, inApp, interviewsDrawn, iv, person, readChosen, readRows, rowsOf, voted, type InterviewsFake, type Iv } from './support/int-ui/interviews';
import { bookedIv, type ScheduleFake } from './support/int-ui/schedule';
import { REASONS, mainButtonOf, openAction, reasonOf, type CloseFake } from './support/int-ui/close';
import { FW, captureButton, fillSheet, sheetOf, submitOf, type Snapshot, type VoteFake } from './support/rec-ui-03/capture';
import {
  SW, blockOf, blockText, decisionsLine, entry, expect, failureOf, legacyVote, loadingOf, main, newVote, noSummary, ownOnly, readBlock, rowText, test,
  tryAgainOf, wordsIn, type Entry, type ScoresFake,
} from './support/int-ui/summary';

/**
 * INT-UI-05 · Panel summary: on a candidate's Interviews tab, when the chosen interview is Done, a Recruiter sees "Panel scores": the
 * panel's average per criterion and overall, each "{n} out of 5", the decisions counted, and "Split panel" when the server says the
 * panel disagreed. Jira NH-274 (epic NH-223, amber). Lock acceptance-lock/int-ui-05 (one squashed commit on the child lock
 * acceptance-lock/int-ui-01.4, which lets the shared chosen-interview helper see the summary's sunken card as part of the chosen card).
 * Spec: specs/interview-journey/cards/INT-UI-05.md, section "Changes after spec check round 1 (27 Nov)" (M-1, M-2, S-1 to S-5, final
 * AC-1 to AC-10, decisions INT-UI-05-D1 to D12). The fakes answer as the merged server does (support/int-ui/summary.ts). Where the spec
 * is silent, cards/int-ui-05.md says what these tests take (T-P1 up).
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg (08:00 UTC), a Thursday.
 * AC-10 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 *
 * Planned green before the build (they guard against a page that reads too much, so they pass on develop where nothing is read):
 * AC-5 "no scores request with no Done interview" and AC-7 "company B sends no scores request". Every other test fails on develop.
 */

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');
const desktopOnly = (why: string) => test.skip(test.info().project.name !== 'desktop-1280', `Desktop only: ${why}`);
const isPhone = () => test.info().project.name === 'phone-390';

type Fx = {
  page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null; record: RecordFake | null;
  events: EventsFake | null; interviews: InterviewsFake | null; sched: ScheduleFake | null; closer: CloseFake | null; voter: VoteFake | null; scores: ScoresFake | null;
};

const BONGANI = 'cand-bongani';
const B_CAND = 'cand-b2';
/** A time on a November 2026 day, given in Johannesburg hours. */
const sast = (day: number, hh: number, mm = 0) => iso(Date.UTC(2026, 10, day, hh - 2, mm));
const BAD_WORDS = /\b(null|undefined|NaN)\b|Invalid Date|\[object Object\]|⟦|\b(STRONG_YES|STRONG_NO|YES|NO)\b|\b(forklift_safety|route_planning|customer_care|problem_solving|teamwork|reliability)\b|MARK|out of 10/;

const SIPHO_V = () => voted('Sipho Ndlovu', 'YES', 4, null, { person_id: 'sub-a-sipho' });
const LERATO_V = () => voted('Lerato Mokoena', 'NO', 2.5, 'Thandi Dube', { person_id: 'sub-a-lerato' });
/** A Done interview on a November day, two people with feedback. */
const doneIv = (id: string, day: number, extra: Partial<Iv> = {}): Iv => iv(id, sast(day, 10), 'COMPLETED', { type: 'TECHNICAL', panel: [SIPHO_V(), LERATO_V()], ...extra });
/** Started yesterday 09:00 with Sipho waiting: Mark as done and Did not happen are open. */
const startedIv = (id = 'iv-s', extra: Partial<Iv> = {}): Iv => iv(id, sast(18, 9), 'SCHEDULED', {
  type: 'PHONE_SCREEN', can: canOf({ did_not_happen: true, mark_done: true }), panel: [person('Sipho Ndlovu', 'WAITING', { person_id: 'sub-a-sipho' })], ...extra,
});

/** Four criteria in an order that is not alphabetical, with a whole number (3) and a half (2.5). */
const CRIT: Array<[string, string, number]> = [['forklift_safety', 'Forklift safety', 3.7], ['route_planning', 'Route planning', 3], ['customer_care', 'Talks to customers', 4.3], ['problem_solving', 'Problem solving', 2.5]];
const CRIT_ROWS: Array<[string, string]> = [['Forklift safety', '3.7'], ['Route planning', '3.0'], ['Talks to customers', '4.3'], ['Problem solving', '2.5']];
const fullEntry = (id: string, extra: Partial<Entry> = {}): Entry => entry(id, CRIT, 3.4, false, [newVote('YES'), newVote('NO'), newVote('YES'), legacyVote('STRONG_NO')], extra);
const FULL_TEXT = blockText({ split: false, overall: '3.4', decisions: '2 Yes · 1 No', rows: CRIT_ROWS });
const small = (id: string, overall: number, split: boolean, votes = [newVote('YES')]): Entry => entry(id, [['teamwork', 'Teamwork', overall]], overall, split, votes);

async function asRecruiter(fx: Fx, who: Who = WHO.recruiterA): Promise<void> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
}
async function openAt(page: Page, id: string, query = ''): Promise<void> {
  await page.goto(`/hire/candidates/${id}${query}`);
  await expect(personHeader(page).or(main(page).getByText(IW.notFound, { exact: true })).or(main(page).getByText('This candidate could not be loaded.', { exact: true })).first()).toBeVisible();
}
/** Gives the candidate its interviews and scores, signs in as A's Recruiter and opens the tab with one chosen. */
async function onTab(fx: Fx, list: Iv[], entries: Entry[], chosen: string, cand = BONGANI, who: Who = WHO.recruiterA): Promise<void> {
  fx.scores!.set(cand, entries);
  fx.sched!.set(cand, list, { done: 1, total: 3 });
  await asRecruiter(fx, who);
  await openAt(fx.page, cand, `?tab=interviews&interview=${chosen}`);
  await interviewsDrawn(fx.page);
  await expect.poll(async () => (await readRows(fx.page)).findIndex((r) => r.selected)).toBe(list.findIndex((x) => x.id === chosen));
}
async function chooseRow(page: Page, n: number): Promise<void> {
  await rowsOf(page).nth(n).click();
  await expect.poll(async () => (await readRows(page)).findIndex((r) => r.selected), { message: `row ${n} is chosen` }).toBe(n);
}
const indexOf = (list: Iv[], id: string) => list.findIndex((x) => x.id === id);
async function chooseId(page: Page, list: Iv[], id: string): Promise<void> { await chooseRow(page, indexOf(list, id)); }
/** The block shows with exactly this text. */
async function blockReads(page: Page, text: string, where: string): Promise<void> {
  await expect(blockOf(page), `${where}: the block shows`).toBeVisible();
  await expect.poll(async () => (await readBlock(page)).text, { message: `${where}: the block reads exactly` }).toBe(text);
}
/** The scores requests settle: wait for the page to go quiet, then count. */
async function readsAfterQuiet(page: Page, scores: ScoresFake, cand = BONGANI): Promise<number> {
  await quiet(page);
  return scores.reads(cand).length;
}

// ================================================================ AC-1 Content
test.describe('AC-1 Content', () => {
  test.beforeEach(noBackendOnly);

  test('AC-1 A chosen Done interview with a full entry shows the group "Panel scores" (heading level 3 under the card\'s level 2 title), the overall with one decimal and "out of 5", the decisions line, and one row per criterion in the answer\'s order with the label exactly and "{mean, one decimal} out of 5" (3 is "3.0"); nothing else of the answer shows; a higher mean has a wider bar, set only through --_pct; no person markup in the block', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const errors = watchErrors(page);
    const list = [doneIv('iv-d2', 12), doneIv('iv-d1', 14), bookedIv('iv-b', sast(24, 10))];
    // The answer's order differs from the list's; the second entry's numbers are whole (3 and 4).
    await onTab(fx, list, [fullEntry('iv-d1'), entry('iv-d2', [['teamwork', 'Teamwork', 3], ['reliability', 'Reliability', 4]], 3, false, [newVote('STRONG_YES')])], 'iv-d1');
    await blockReads(page, FULL_TEXT, 'iv-d1');
    const b = await readBlock(page);
    expect(b.rows, 'one row per criterion, in the answer\'s order').toEqual(CRIT_ROWS.map(([l, n]) => rowText(l, n)));
    expect(b.headings, 'one heading in the block: "Panel scores" at level 3').toEqual([{ level: 3, text: SW.heading }]);
    expect(b.insideChosen, 'the block is inside the chosen interview').toBe(true);
    await expect(chosenOf(page).locator('.pp-card__title').first(), 'the card title is level 2').toHaveJSProperty('tagName', 'H2');
    expect(b.styled, 'no style but custom properties (S-1)').toEqual([]);
    expect(b.foreign, 'no person, avatar, time, deadline or other list item in the block (S-4)').toEqual([]);
    // Bars: 4.3 > 3.7 > 3.0 > 2.5.
    const [f37, f30, f43, f25] = b.fills;
    expect(b.fills.every((w) => w > 0), `every row has a drawn .pp-scorecard__fill (${b.fills.join(', ')})`).toBe(true);
    expect(f43! > f37! && f37! > f30! && f30! > f25!, `a higher mean has a wider bar (${b.fills.join(', ')})`).toBe(true);
    const text = await main(page).innerText();
    for (const never of ['MARK', 'Own-only', 'out of 10', 'forklift_safety', 'MARK criteria label']) expect(text, `"${never}" never shows`).not.toContain(never);
    await chooseId(page, list, 'iv-d2');
    await blockReads(page, blockText({ split: false, overall: '3.0', decisions: '1 Strong yes', rows: [['Teamwork', '3.0'], ['Reliability', '4.0']] }), 'iv-d2');
    expect(errors).toEqual([]);
  });
});

// ================================================================ AC-2 Decisions counted
test.describe('AC-2 Decisions counted', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2 The decisions line counts only new rated votes, in the order Strong yes, Yes, No, Strong no, zero counts left out, joined by " · ": all four; only Yes; Strong yes and Strong no; legacy votes with ratings beside a new one; a legacy vote with no rating', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const mixes: Array<{ votes: ReturnType<typeof newVote>[]; want: string }> = [
      { votes: [newVote('NO'), newVote('STRONG_NO'), newVote('YES'), newVote('STRONG_YES'), newVote('YES')], want: '1 Strong yes · 2 Yes · 1 No · 1 Strong no' },
      { votes: [newVote('YES'), newVote('YES'), newVote('YES')], want: '3 Yes' },
      { votes: [newVote('STRONG_NO'), newVote('STRONG_YES')], want: '1 Strong yes · 1 Strong no' },
      { votes: [legacyVote('YES'), newVote('NO'), legacyVote('STRONG_YES'), legacyVote('NO')], want: '1 No' },
      { votes: [newVote('NO'), legacyVote(null), newVote('YES')], want: '1 Yes · 1 No' },
    ];
    const list = mixes.map((_, i) => doneIv(`iv-m${i}`, 10 + i));
    const entries = mixes.map((m, i) => small(`iv-m${i}`, 3.5, false, m.votes));
    await onTab(fx, list, entries, 'iv-m0');
    for (const [i, m] of mixes.entries()) {
      if (i) await chooseRow(page, i);
      expect(decisionsLine(m.votes.filter((v) => !v.legacy).map((v) => v.rating)), 'control: the helper agrees').toBe(m.want);
      await blockReads(page, blockText({ split: false, overall: '3.5', decisions: m.want, rows: [['Teamwork', '3.5']] }), `mix ${i}`);
    }
    expect(await readsAfterQuiet(page, scores!), 'one scores read for all of them').toBe(1);
  });
});

// ================================================================ AC-3 Split panel
test.describe('AC-3 Split panel', () => {
  test.beforeEach(noBackendOnly);

  test('AC-3 "Split panel" (warning tone, an icon, as text) shows exactly when the entry\'s split is true, also when split disagrees with the ratings both ways, so a page that works it out fails', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const cases: Array<{ split: boolean; votes: ReturnType<typeof newVote>[]; why: string }> = [
      { split: true, votes: [newVote('YES'), newVote('YES')], why: 'split true, every rating Yes' },
      { split: false, votes: [newVote('YES'), newVote('STRONG_NO')], why: 'split false, Yes and Strong no' },
      { split: true, votes: [newVote('YES'), newVote('NO')], why: 'split true, Yes and No' },
      { split: false, votes: [newVote('STRONG_YES'), newVote('YES')], why: 'split false, Strong yes and Yes' },
    ];
    const list = cases.map((_, i) => doneIv(`iv-s${i}`, 10 + i));
    await onTab(fx, list, cases.map((c, i) => small(`iv-s${i}`, 4, c.split, c.votes)), 'iv-s0');
    for (const [i, c] of cases.entries()) {
      if (i) await chooseRow(page, i);
      const want = blockText({ split: c.split, overall: '4.0', decisions: decisionsLine(c.votes.map((v) => v.rating)), rows: [['Teamwork', '4.0']] });
      await blockReads(page, want, c.why);
      const b = await readBlock(page);
      if (c.split) expect(b.split, `${c.why}: "Split panel" as a warning lozenge with its icon`).toEqual({ text: SW.split, warning: true, icon: true });
      else expect(b.split, `${c.why}: no "Split panel"`).toBeNull();
    }
  });
});

// ================================================================ AC-4 Where and when
test.describe('AC-4 Where and when', () => {
  test.beforeEach(noBackendOnly);

  test('AC-4 No block on a chosen Booked, Waiting on feedback, Cancelled or Did not happen interview even with a full entry for each, and no scores request caused by them; the Done one shows it; choosing away from it leaves no block anywhere', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const list = [
      iv('iv-c', sast(10, 10), 'CANCELLED', { closed_reason: 'CANDIDATE_ASKED', panel: [SIPHO_V()] }),
      iv('iv-n', sast(11, 10), 'DID_NOT_HAPPEN', { closed_reason: 'OTHER', closed_note: 'Rain', panel: [SIPHO_V()] }),
      doneIv('iv-d', 12),
      iv('iv-w', sast(18, 9), 'SCHEDULED', { panel: [SIPHO_V(), person('Thabo Khumalo', 'WAITING', { person_id: 'sub-a-thabo' })] }),
      bookedIv('iv-b', sast(24, 10)),
    ];
    await onTab(fx, list, list.map((x) => fullEntry(x.id!)), 'iv-b');
    for (const id of ['iv-b', 'iv-w', 'iv-c', 'iv-n']) {
      if (id !== 'iv-b') await chooseId(page, list, id);
      await quiet(page);
      await noSummary(page, id);
      expect(scores!.reads().length, `${id}: no scores request caused by a chosen interview that is not Done`).toBe(0);
    }
    await chooseId(page, list, 'iv-d');
    await blockReads(page, FULL_TEXT, 'iv-d');
    for (const id of ['iv-c', 'iv-b']) {
      await chooseId(page, list, id);
      await noSummary(page, `${id} after the Done one`);
    }
  });

  test('AC-4 No block and no error when there is nothing to sum up: vote_count 0, overall null, no entry for the interview; the full one beside them shows (one read for all)', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const list = [doneIv('iv-z', 10), doneIv('iv-o', 11), doneIv('iv-x', 12), doneIv('iv-d', 13)];
    const entries = [
      fullEntry('iv-z', { vote_count: 0 }),
      fullEntry('iv-o', { overall: null }),
      fullEntry('iv-d'),
    ];
    await onTab(fx, list, entries, 'iv-z');
    for (const id of ['iv-z', 'iv-o', 'iv-x']) {
      if (id !== 'iv-z') await chooseId(page, list, id);
      await quiet(page);
      await noSummary(page, id);
    }
    await chooseId(page, list, 'iv-d');
    await blockReads(page, FULL_TEXT, 'control iv-d');
    expect(await readsAfterQuiet(page, scores!)).toBe(1);
  });

  for (const [what, refusal] of [
    ['the own-only shape (200, no numbers)', { status: 200, body: ownOnly(BONGANI, ['iv-d1', 'iv-d2']) }],
    ['403', { status: 403, body: { error: 'Forbidden' } }],
    ['404', { status: 404, body: { error: 'Not found' } }],
  ] as const) {
    test(`AC-4 ${what}: no block and no error on the chosen Done interview, and none on another Done one chosen next, with no further request (the answer is kept for this interviews read)`, async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
      const list = [doneIv('iv-d1', 12), doneIv('iv-d2', 14)];
      scores!.refuse(refusal);
      await onTab(fx, list, [fullEntry('iv-d1'), fullEntry('iv-d2')], 'iv-d1');
      await expect.poll(() => scores!.reads().length).toBe(1);
      await quiet(page);
      await noSummary(page, 'iv-d1');
      expect((await readChosen(page)).people.length, 'the person lines still show').toBe(2);
      await chooseId(page, list, 'iv-d2');
      await quiet(page);
      await noSummary(page, 'iv-d2');
      expect(scores!.reads().length, 'no further request').toBe(1);
    });
  }

  test('AC-4 The block is the first thing in the chosen card: under the card title, above the status lozenge, the details and the person lines (both widths)', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const list = [doneIv('iv-d', 12, { closed_reason: 'FEEDBACK_GIVEN_ANOTHER_WAY' }), bookedIv('iv-b', sast(24, 10))];
    await onTab(fx, list, [fullEntry('iv-d')], 'iv-d');
    await blockReads(page, FULL_TEXT, 'iv-d');
    const at = await page.evaluate(([chosenSel]) => {
      const card = document.querySelector(`main ${chosenSel}`)!;
      const block = [...card.querySelectorAll('[role="group"]')].find((g) => (g.textContent ?? '').includes('Panel scores'))!;
      const r = (e: Element | null | undefined) => (e ? e.getBoundingClientRect() : null);
      const title = card.querySelector('.pp-card__title');
      const status = [...card.querySelectorAll('.pp-lozenge')].find((l) => !block.contains(l) && (l.textContent ?? '').trim() === 'Done');
      const reason = [...card.querySelectorAll('*')].find((e) => !block.contains(e) && e.children.length === 0 && (e.textContent ?? '').trim() === 'Feedback was given another way');
      const people = [...card.querySelectorAll('.pp-person')];
      return {
        title: r(title)!.bottom, top: r(block)!.top, bottom: r(block)!.bottom, status: r(status)?.top ?? null, reason: r(reason)?.top ?? null,
        firstPerson: people.length ? r(people[0])!.top : null,
        before: (() => { const w = document.createTreeWalker(card, NodeFilter.SHOW_ELEMENT); const seen: string[] = []; while (w.nextNode()) { const e = w.currentNode as Element; if (e === block) break; if (e.classList.contains('pp-lozenge') || e.classList.contains('pp-person')) seen.push(e.className); } return seen; })(),
      };
    }, [CHOSEN] as const);
    expect(at.status, 'the status lozenge "Done" is in the card').not.toBeNull();
    expect(at.top, 'under the card title').toBeGreaterThanOrEqual(at.title - 1);
    expect(at.bottom, 'above the status lozenge').toBeLessThanOrEqual(at.status! + 1);
    expect(at.bottom, 'above the details').toBeLessThanOrEqual(at.reason! + 1);
    expect(at.bottom, 'above the person lines').toBeLessThanOrEqual(at.firstPerson! + 1);
    expect(at.before, 'no lozenge or person comes before the block in the card').toEqual([]);
  });
});

// ================================================================ AC-5 Reads
test.describe('AC-5 Reads', () => {
  test.beforeEach(noBackendOnly);

  test('AC-5 (green before the build by design) A candidate with no Done interview: choosing every interview sends no scores request', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const list = [iv('iv-c', sast(10, 10), 'CANCELLED', { closed_reason: 'CANDIDATE_ASKED' }), startedIv(), bookedIv('iv-b', sast(24, 10))];
    await onTab(fx, list, list.map((x) => fullEntry(x.id!)), 'iv-b');
    for (let i = 0; i < list.length; i++) await chooseRow(page, i);
    expect(await readsAfterQuiet(page, scores!), 'no scores request').toBe(0);
  });

  test('AC-5 Choosing the first Done interview sends exactly one GET /v1/candidates/{id}/scores with no query, no body, no Idempotency-Key and no company; choosing a second Done one, or going away and back, sends none', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const list = [doneIv('iv-d1', 12), doneIv('iv-d2', 14), bookedIv('iv-b', sast(24, 10))];
    await onTab(fx, list, [fullEntry('iv-d1'), small('iv-d2', 4, true)], 'iv-b');
    expect(await readsAfterQuiet(page, scores!), 'nothing read on a booked interview').toBe(0);
    await chooseId(page, list, 'iv-d1');
    await blockReads(page, FULL_TEXT, 'iv-d1');
    await chooseId(page, list, 'iv-d2');
    await expect(blockOf(page)).toBeVisible();
    await chooseId(page, list, 'iv-b');
    await chooseId(page, list, 'iv-d1');
    await blockReads(page, FULL_TEXT, 'iv-d1 again');
    expect(await readsAfterQuiet(page, scores!), 'exactly one scores request').toBe(1);
    const c = scores!.reads()[0]!;
    expect([c.method, c.path, c.query, c.idempotencyKey, c.body, c.email]).toEqual(['GET', `/v1/candidates/${BONGANI}/scores`, {}, null, null, WHO.recruiterA.email]);
    expect(companyIdIn(c), 'no company id or company key anywhere in the request').toEqual([]);
  });

  test('AC-5 After Mark as done (INT-UI-03) leaves the now Done interview chosen, the tab reads the interviews again and exactly one more scores request goes, and its block shows', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const list = [doneIv('iv-d', 12), startedIv('iv-s')];
    await onTab(fx, list, [fullEntry('iv-d'), small('iv-s', 2, false, [newVote('NO')])], 'iv-d');
    await blockReads(page, FULL_TEXT, 'iv-d');
    await chooseId(page, list, 'iv-s');
    await noSummary(page, 'iv-s before');
    expect(await readsAfterQuiet(page, scores!)).toBe(1);
    const before = interviews!.reads(BONGANI).length;
    const d = await openAction(page, 'complete', 'PHONE_SCREEN');
    await reasonOf(d, REASONS.complete[0]![1]).check();
    await mainButtonOf(d, 'complete').click();
    await expect(d).toBeHidden();
    await expect.poll(() => interviews!.reads(BONGANI).length).toBe(before + 1);
    await blockReads(page, blockText({ split: false, overall: '2.0', decisions: '1 No', rows: [['Teamwork', '2.0']] }), 'iv-s after Mark as done');
    expect(await readsAfterQuiet(page, scores!), 'exactly one more scores request').toBe(2);
  });

  test('AC-5 After a capture (REC-UI-03.2) whose vote makes the interview Done (the next interviews read held, Submit, 201, the interview set COMPLETED, the read released), exactly one more scores request goes and its block shows', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const SNAP: Snapshot = [{ key: 'teamwork', label: 'Teamwork' }];
    const cap = iv('iv-cap', sast(18, 9), 'SCHEDULED', {
      type: 'TECHNICAL', can: canOf({ capture_feedback: true, mark_done: true }), panel: [person('Thabo Khumalo', 'WAITING', { person_id: 'sub-a-thabo' })],
    });
    const list = [doneIv('iv-d', 12), cap];
    voter!.snapshot('iv-cap', SNAP);
    voter!.snapshot('iv-d', SNAP);
    await onTab(fx, list, [fullEntry('iv-d'), small('iv-cap', 4, false)], 'iv-d');
    await blockReads(page, FULL_TEXT, 'iv-d');
    await chooseId(page, list, 'iv-cap');
    await noSummary(page, 'iv-cap before');
    expect(await readsAfterQuiet(page, scores!)).toBe(1);
    await captureButton(page).click();
    const s = sheetOf(page, FW.title('Bongani', 'Mthembu'));
    await expect(s).toBeVisible();
    await fillSheet(s, { person: 'Thabo Khumalo', scores: [4], decision: 'Yes', criteria: SNAP });
    interviews!.refuse({ hold: true, id: BONGANI });
    await submitOf(s).click();
    await expect.poll(() => voter!.posts.at(-1)?.status, { message: 'the capture is saved (201)' }).toBe(201);
    await expect.poll(() => interviews!.heldCount, { message: 'the next interviews read is held' }).toBe(1);
    // The server makes the interview Done by itself once the last waiting person has given feedback (recomputeInterview); the
    // capture fake does not, so the test does it here, before the held read is answered (M-1 as corrected after round 2).
    const x = sched!.listOf(BONGANI).find((i) => i.id === 'iv-cap')!;
    x.status = 'COMPLETED';
    x.can = canOf('none');
    interviews!.release();
    await blockReads(page, blockText({ split: false, overall: '4.0', decisions: '1 Yes', rows: [['Teamwork', '4.0']] }), 'iv-cap after the capture');
    expect(await readsAfterQuiet(page, scores!), 'exactly one more scores request').toBe(2);
    expect((await readRows(page)).findIndex((r) => r.selected), 'the captured interview stays chosen').toBe(1);
  });
});

// ================================================================ AC-6 States
test.describe('AC-6 States', () => {
  test.beforeEach(noBackendOnly);

  test('AC-6 While the scores read is in flight the chosen Done interview shows a status region "Loading the panel scores" and its person lines; the answer then shows the block and the skeleton goes', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    scores!.refuse({ hold: true });
    await onTab(fx, [doneIv('iv-d', 12)], [fullEntry('iv-d')], 'iv-d');
    await expect.poll(() => scores!.heldCount).toBe(1);
    await expect(loadingOf(page)).toBeVisible();
    await expect(blockOf(page)).toHaveCount(0);
    expect((await readChosen(page)).people.length, 'the person lines show while it loads').toBe(2);
    scores!.release();
    await blockReads(page, FULL_TEXT, 'after the answer');
    await expect(main(page).getByText(SW.loading, { exact: true })).toHaveCount(0);
  });

  for (const [what, refusal] of [['a dropped connection', { abort: true }], ['500', { status: 500 }], ['502', { status: 502, body: { message: 'Bad gateway' } }]] as const) {
    test(`AC-6 ${what}: "Panel scores could not be loaded." (danger) with "Try again" in the chosen card while the person lines still show; "Try again" sends exactly one more request and its 200 shows the block`, async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
      const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
      scores!.refuse(refusal);
      await onTab(fx, [doneIv('iv-d', 12)], [fullEntry('iv-d')], 'iv-d');
      await expect(failureOf(page)).toBeVisible();
      await expect(tryAgainOf(page)).toBeVisible();
      await expect(blockOf(page)).toHaveCount(0);
      expect((await readChosen(page)).people.length, 'the person lines still show').toBe(2);
      expect(await readsAfterQuiet(page, scores!)).toBe(1);
      await tryAgainOf(page).click();
      await blockReads(page, FULL_TEXT, 'after Try again');
      await expect(main(page).getByText(SW.failed, { exact: true })).toHaveCount(0);
      expect(await readsAfterQuiet(page, scores!), 'exactly one more request').toBe(2);
    });
  }

  test('AC-6 A failed read is kept for this interviews read (D11): another Done interview chosen next shows the failure and sends nothing; "Try again" sends exactly one; then both Done interviews show their blocks with no further request', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const list = [doneIv('iv-d1', 12), doneIv('iv-d2', 14)];
    scores!.refuse({ status: 500 });
    await onTab(fx, list, [fullEntry('iv-d1'), small('iv-d2', 4, true)], 'iv-d1');
    await expect(failureOf(page)).toBeVisible();
    await chooseId(page, list, 'iv-d2');
    await expect(failureOf(page)).toBeVisible();
    expect(await readsAfterQuiet(page, scores!), 'choosing sends nothing after a failure').toBe(1);
    await tryAgainOf(page).click();
    await blockReads(page, blockText({ split: true, overall: '4.0', decisions: '1 Yes', rows: [['Teamwork', '4.0']] }), 'iv-d2 after Try again');
    await chooseId(page, list, 'iv-d1');
    await blockReads(page, FULL_TEXT, 'iv-d1');
    expect(await readsAfterQuiet(page, scores!), 'one request for Try again, none after').toBe(2);
  });
});

// ================================================================ AC-7 Company B and sign-out
test.describe('AC-7 Company B and sign-out', () => {
  test.beforeEach(noBackendOnly);

  const B_ENTRY = () => entry('iv-bd', [['load_planning', 'Load planning', 2.2]], 2.2, false, [newVote('NO')]);
  const B_TEXT = blockText({ split: false, overall: '2.2', decisions: '1 No', rows: [['Load planning', '2.2']] });
  const bList = () => [iv('iv-bd', sast(13, 10), 'COMPLETED', { type: 'FINAL', panel: [voted('Lindiwe Peters', 'NO', 2.2, null, { person_id: 'sub-b-lindiwe' })] })];

  test('AC-7 (no-request half green before the build by design) Company B\'s Recruiter on A\'s candidate, with and without a Done interview named, sees "This candidate could not be found." and sends no scores request; on B\'s own candidate B\'s block shows from B\'s own request', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    scores!.set(BONGANI, [fullEntry('iv-d')]);
    sched!.set(BONGANI, [doneIv('iv-d', 12)]);
    scores!.set(B_CAND, [B_ENTRY()]);
    sched!.set(B_CAND, bList());
    modules!.answers.B = ['onboarding', 'recruitment'];
    await asRecruiter(fx, WHO.recruiterB);
    for (const q of ['?tab=interviews', '?tab=interviews&interview=iv-d']) {
      await openAt(page, BONGANI, q);
      await expect(main(page).getByText(IW.notFound, { exact: true })).toBeVisible();
      await quiet(page);
      await noSummary(page, q);
      const html = await page.content();
      for (const a of ['Bongani', 'Forklift safety', 'Talks to customers']) expect(html, `nothing of A (${a})`).not.toContain(a);
    }
    expect(scores!.reads().length, 'no scores request for A\'s candidate').toBe(0);
    await openAt(page, B_CAND, '?tab=interviews&interview=iv-bd');
    await interviewsDrawn(page);
    await blockReads(page, B_TEXT, 'B\'s own');
    const c = scores!.reads().at(-1)!;
    expect([c.email, c.company, c.path, c.status]).toEqual([WHO.recruiterB.email, 'B', `/v1/candidates/${B_CAND}/scores`, 200]);
    expect(companyIdIn(c)).toEqual([]);
    expect(scores!.reads().length).toBe(1);
  });

  test('AC-7 A\'s scores answer held, A signs out and B\'s Recruiter signs in on the same page with no reload and opens B\'s candidate: nothing of A\'s block (labels, numbers, decisions) shows at any moment, also after A\'s answer is released late; B\'s block shows B\'s numbers', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const A_ENTRY = entry('iv-d', [['forklift_safety', 'A-only Forklift safety', 4.7]], 4.7, true, [newVote('STRONG_YES'), newVote('STRONG_YES'), newVote('STRONG_YES'), newVote('STRONG_YES'), newVote('STRONG_YES')]);
    scores!.set(B_CAND, [B_ENTRY()]);
    sched!.set(B_CAND, bList());
    scores!.refuse({ hold: true });
    await onTab(fx, [doneIv('iv-d', 12)], [A_ENTRY], 'iv-d');
    await expect.poll(() => scores!.heldCount, { message: 'A\'s scores read is held' }).toBe(1);
    await avatarButton(page).dispatchEvent('click');
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).dispatchEvent('click');
    await expect(page).toHaveURL(/\/sign-in/);
    const aWords = ['A-only Forklift safety', '4.7', '5 Strong yes', 'Bongani'];
    await page.evaluate((words) => {
      const seen: string[] = [];
      (window as unknown as { __seenA: string[] }).__seenA = seen;
      const check = () => {
        const all = document.body?.innerText ?? '';
        const html = document.documentElement.outerHTML;
        for (const w of words) if (all.includes(w) || (w !== '4.7' && html.includes(w))) seen.push(`${w} at ${location.pathname}${location.search}`);
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
    await inApp(page, `/hire/candidates/${B_CAND}?tab=interviews&interview=iv-bd`);
    await interviewsDrawn(page);
    await blockReads(page, B_TEXT, 'B\'s block');
    scores!.release();
    await quiet(page);
    await page.waitForTimeout(500);
    await blockReads(page, B_TEXT, 'B\'s block after A\'s late answer');
    expect(await seenA(), 'nothing of A at any moment').toEqual([]);
  });

  test('AC-7 Switching candidate in the same tab with no reload while the first candidate\'s scores answer is held: the late answer never draws, also where the second candidate\'s Done interview has the same id; the second candidate\'s block shows its own numbers from its own request', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    // Found by planted fault F25 (the page keeps a scores answer that comes back after the candidate changed): sign-out drops the
    // page, a same-tab switch keeps it (as INT-UI-01 AC-6).
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const TENDAI = 'cand-tendai';
    const FIRST = entry('iv-d', [['forklift_safety', 'First-only Forklift safety', 4.7]], 4.7, true, [newVote('STRONG_YES'), newVote('STRONG_NO')]);
    const SECOND_TEXT = blockText({ split: false, overall: '2.0', decisions: '1 No', rows: [['Teamwork', '2.0']] });
    sched!.set(TENDAI, [doneIv('iv-d', 14)], { done: 1, total: 2 });
    scores!.set(TENDAI, [small('iv-d', 2, false, [newVote('NO')])]);
    scores!.refuse({ hold: true });
    await onTab(fx, [doneIv('iv-d', 12)], [FIRST], 'iv-d');
    await expect.poll(() => scores!.heldCount, { message: 'the first candidate\'s scores read is held' }).toBe(1);
    await inApp(page, `/hire/candidates/${TENDAI}?tab=interviews&interview=iv-d`);
    await expect.poll(async () => (await personHeader(page).count()) && (await personHeader(page).innerText()).includes('Tendai')).toBe(true);
    await interviewsDrawn(page);
    await blockReads(page, SECOND_TEXT, 'the second candidate');
    scores!.release();
    await quiet(page);
    await page.waitForTimeout(500);
    await blockReads(page, SECOND_TEXT, 'the second candidate after the first answer came late');
    const html = await page.content();
    for (const w of ['First-only Forklift safety', '4.7', '1 Strong yes']) expect(html, `the late answer draws nothing: ${w}`).not.toContain(w);
    expect(scores!.reads(TENDAI), 'one scores request for the second candidate').toHaveLength(1);
  });
});

// ================================================================ AC-8 Words
test.describe('AC-8 Words', () => {
  test.beforeEach(noBackendOnly);

  test('AC-8 Every visible string and accessible name of the block, in every state (shown with and without "Split panel", loading, failed), is an approved word, a kit word, a W-N line, a number with one decimal, the decisions line or a criterion label from the answer; no ⟦, "null", "undefined", "NaN", rating codes or criterion keys', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const list = [doneIv('iv-d1', 12), doneIv('iv-d2', 14)];
    const labels = CRIT.map((c) => c[1]).concat('Teamwork');
    const allowed = (w: string) => (Object.values(SW) as string[]).includes(w) || labels.includes(w) || /^\d\.\d$/.test(w)
      || ['2 Yes · 1 No', '1 Yes'].includes(w) || labels.some((l) => w === rowText(l, w.split(' ').at(-4) ?? '')) || /^\d\.\d out of 5$/.test(w);
    const judge = (where: string, words: string[]) => {
      expect(words.length, `${where}: has words`).toBeGreaterThan(0);
      expect(words.filter((w) => !allowed(w)), `${where}: only allowed words`).toEqual([]);
      expect(words.filter((w) => BAD_WORDS.test(w)), `${where}: no code, key or broken value`).toEqual([]);
    };
    scores!.refuse({ hold: true });
    await onTab(fx, list, [fullEntry('iv-d1'), small('iv-d2', 4, true)], 'iv-d1');
    await expect(loadingOf(page)).toBeVisible();
    judge('loading', await wordsIn(loadingOf(page)));
    scores!.release();
    await blockReads(page, FULL_TEXT, 'shown');
    judge('shown, not split', await wordsIn(blockOf(page)));
    await chooseId(page, list, 'iv-d2');
    await blockReads(page, blockText({ split: true, overall: '4.0', decisions: '1 Yes', rows: [['Teamwork', '4.0']] }), 'split');
    judge('shown, split', await wordsIn(blockOf(page)));
    // A new page load gives a new interviews read; this one's scores read fails.
    scores!.refuse({ status: 500 });
    await openAt(page, BONGANI, '?tab=interviews&interview=iv-d1');
    await interviewsDrawn(page);
    await expect(failureOf(page)).toBeVisible();
    judge('failed', await wordsIn(failureOf(page)));
    expect(await wordsIn(failureOf(page))).toEqual(expect.arrayContaining([SW.failed, SW.tryAgain]));
  });

  test('AC-8 The words table: the summary lines are plain strings in interview-words.ts; the words check passes on it and fails on a planted null row', async () => {
    desktopOnly('it checks files, not the page');
    const repo = join(__dirname, '..', '..', '..');
    const script = join(repo, 'scripts', 'ci', 'check-interview-words.mjs');
    const words = join(repo, 'pepla-web', 'src', 'app', 'features', 'recruitment', 'interviews', 'interview-words.ts');
    const text = readFileSync(words, 'utf8');
    const body = text.slice(text.indexOf('INTERVIEW_WORDS'), text.indexOf('};', text.indexOf('INTERVIEW_WORDS')));
    for (const w of [SW.heading, SW.split, SW.outOf, SW.criteria, SW.failed, SW.loading]) {
      expect(body, `INTERVIEW_WORDS holds "${w}" as a plain string`).toMatch(new RegExp(`(['"\`])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`));
    }
    const run = (args: string[]): number => {
      try { execFileSync('node', [script, ...args], { cwd: repo, stdio: 'pipe' }); return 0; } catch (e) { return (e as { status?: number }).status ?? 1; }
    };
    expect(run([]), 'the check passes on the real table').toBe(0);
    const failed = new RegExp(`(['"\`])${SW.failed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\1`).exec(text);
    expect(failed, 'the failure row is a string literal').toBeTruthy();
    const dir = mkdtempSync(join(tmpdir(), 'int-ui-05-'));
    try {
      const copy = join(dir, 'interview-words.ts');
      writeFileSync(copy, text);
      expect(run([copy]), 'the check passes on an exact copy').toBe(0);
      writeFileSync(copy, text.replace(failed![0], 'null'));
      expect(run([copy]), 'a planted null row fails the check').not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ================================================================ AC-9 Phone
test.describe('AC-9 Phone', () => {
  test.beforeEach(noBackendOnly);

  test('AC-9 At 390 the block sits under the interview list, inside the chosen card and above the person lines; at both widths every label and number of the block is visible, not under the top bar, not covered, not cut off, and nothing scrolls sideways; at 1280 the list and the chosen card stay side by side', async ({ page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores }) => {
    const fx: Fx = { page, signIn, cognito, modules, hire, record, events, interviews, sched, closer, voter, scores };
    const LONG = 'Talks to customers and colleagues clearly on a busy depot floor';
    const e = entry('iv-d', [['forklift_safety', 'Forklift safety', 3.7], ['customer_care', LONG, 4.3]], 4, true, [newVote('YES'), newVote('NO'), newVote('STRONG_YES')]);
    const list = [bookedIv('iv-b', sast(24, 10)), doneIv('iv-d', 12), iv('iv-c', sast(10, 10), 'CANCELLED', { closed_reason: 'CANDIDATE_ASKED' })];
    await onTab(fx, list, [e], 'iv-d');
    await blockReads(page, blockText({ split: true, overall: '4.0', decisions: '1 Strong yes · 1 Yes · 1 No', rows: [['Forklift safety', '3.7'], [LONG, '4.3']] }), 'iv-d');
    await quiet(page);
    const problems = await page.evaluate(async ([splitWords]) => {
      const out: string[] = [];
      const width = document.documentElement.clientWidth;
      const bar = document.querySelector('pp-top-navigation')?.getBoundingClientRect();
      const block = [...document.querySelectorAll('main [role="group"]')].find((g) => (g.textContent ?? '').includes('Panel scores'));
      if (!block) return ['no block'];
      const targets = [
        ...block.querySelectorAll<HTMLElement>('h1, h2, h3, h4, [role="heading"]'),
        ...[...block.querySelectorAll<HTMLElement>('.pp-lozenge')].filter((x) => (x.textContent ?? '').trim() === splitWords),
        ...block.querySelectorAll<HTMLElement>('.pp-scorecard__value, .pp-scorecard__out-of, .pp-scorecard__word, .pp-scorecard__name, .pp-scorecard__score'),
        ...block.querySelectorAll<HTMLElement>('li'),
      ];
      if (targets.length < 8) out.push(`only ${targets.length} parts found to check`);
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
        const y = Math.min(Math.max(r.top + Math.min(r.height / 2, 20), 1), innerHeight - 1);
        const hit = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 1), width - 1), y);
        if (hit && !el.contains(hit) && !hit.contains(el)) out.push(`${label} is covered by ${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}`);
      }
      window.scrollTo(0, 0);
      if (document.documentElement.scrollWidth > width + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide)`);
      return out;
    }, [SW.split] as const);
    expect(problems).toEqual([]);
    const listBox = (await main(page).locator(LIST).first().boundingBox())!;
    const blockBox = (await blockOf(page).boundingBox())!;
    const cardBox = (await chosenOf(page).boundingBox())!;
    const firstPerson = (await chosenOf(page).locator('.pp-person').first().boundingBox())!;
    expect((await readBlock(page)).insideChosen, 'inside the chosen card').toBe(true);
    expect(blockBox.y + blockBox.height, 'above the person lines').toBeLessThanOrEqual(firstPerson.y + 1);
    if (isPhone()) {
      expect(blockBox.y, 'at 390 the block is under the interview list').toBeGreaterThanOrEqual(listBox.y + listBox.height - 1);
    } else {
      expect(cardBox.x, 'at 1280 the chosen card is beside the list').toBeGreaterThanOrEqual(listBox.x + listBox.width - 1);
      expect(Math.abs(cardBox.y - listBox.y) < 200, 'at 1280 the two columns start together').toBe(true);
    }
  });
});

// ================================================================ AC-10 pepla-dev
test.describe('AC-10 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-10 runs on pepla-dev only.');
  // One seed serves both widths: the page only reads (spec "Pepla-dev seed").
  type DevIds = {
    candidate: string; firstName: string; lastName: string; done: { id: string; type: string }; empty: { id: string; type: string };
    expected: { overall: string; criteria: Array<[string, string]>; decisions: string; split: boolean };
  };
  const DEV = JSON.parse(readFileSync(join(__dirname, 'support', 'int-ui', 'dev-ids-05.json'), 'utf8')) as DevIds;

  test('AC-10 @pepla-dev The company A HR login opens the seeded candidate at ?tab=interviews, chooses the Done interview with votes and sees "Panel scores", "Split panel", the seeded overall, criterion numbers and "1 Yes · 1 No"; the Done interview with no votes shows no block and no error', async ({ page, signIn, hr }) => {
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto(`/hire/candidates/${DEV.candidate}?tab=interviews&interview=${DEV.done.id}`);
    await expect(personHeader(page)).toBeVisible();
    await interviewsDrawn(page);
    await expect(main(page).getByText(IW.failed, { exact: true })).toHaveCount(0);
    const want = blockText({ split: DEV.expected.split, overall: DEV.expected.overall, decisions: DEV.expected.decisions, rows: DEV.expected.criteria });
    await expect(blockOf(page)).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await readBlock(page)).text, { timeout: 15_000 }).toBe(want);
    expect((await readBlock(page)).split?.text).toBe(SW.split);
    const rows = await readRows(page);
    const ei = rows.findIndex((r) => r.text.startsWith(DEV.empty.type));
    expect(ei, `the seeded ${DEV.empty.type} interview`).toBeGreaterThanOrEqual(0);
    await chooseRow(page, ei);
    await quiet(page);
    await noSummary(page, 'the Done interview with no votes');
    expect((await readChosen(page)).text).not.toMatch(BAD_WORDS);
    test.info().annotations.push({ type: 'record', description: page.url() });
  });

  test('AC-10 @pepla-dev Company B\'s HR login opening that candidate sees "This candidate could not be found." and no criterion label or name of A. It fails when E2E_B_HR_* is not set (a skip is not a pass)', async ({ page, signIn }) => {
    const email = process.env['E2E_B_HR_EMAIL'], password = process.env['E2E_B_HR_PASSWORD'];
    expect(email && password, 'E2E_B_HR_EMAIL and E2E_B_HR_PASSWORD must be set on the dev run: the company B half cannot be skipped').toBeTruthy();
    await signIn.open();
    await signIn.signInAs({ email: email!, password: password! });
    await expect(page).toHaveURL('/hr');
    await openNav(page);
    const recruitmentOn = (await navLabels(page)).includes('Candidates');
    for (const q of ['?tab=interviews', `?tab=interviews&interview=${DEV.done.id}`]) {
      await page.goto(`/hire/candidates/${DEV.candidate}${q}`);
      await quiet(page);
      if (recruitmentOn) await expect(main(page).getByText(IW.notFound, { exact: true })).toBeVisible();
      else await expect(page).toHaveURL('/hr');
      await noSummary(page, q);
      const html = await page.content();
      expect(html).not.toContain(DEV.lastName);
      for (const [label] of DEV.expected.criteria) expect(await main(page).innerText(), `no criterion label of A (${label})`).not.toContain(label);
    }
  });
});
