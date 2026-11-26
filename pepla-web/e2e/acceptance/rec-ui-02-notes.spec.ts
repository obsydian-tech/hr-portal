import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { ON_DEV, type SignInPage } from './support/fixtures';
import type { CognitoFake } from './support/cognito-fake';
import type { ModulesFake } from './support/mod-02/modules-fake';
import { navLabels, openNav } from './support/mod-02/shell-snapshot';
import { WHO, enter, iso, quiet, watchErrors, type HireFake, type Who } from './support/rec-ui/harness';
import { chooseStage, dialog as moveDialog, moveButton, reason } from './support/ang-01/gallery';
import { RW, detailsCard, main, nextStepCard, openRecord, pageButton, personHeader, readHeader, tabNames, type RecordFake } from './support/rec-ui-02/record';
import {
  MARK, NW, SOURCE, added, addedLine, chooseNotes, chooseOverview, eventsOf, expect, historyFor, inApp, listChange, listLine, moved, movedLine, notHired,
  notHiredLine, notesRegion, other, readDays, readLines, reasonLine, sastExact, tab, test, timeline, type EventsFake, type Row,
} from './support/rec-ui-02/notes';

/**
 * REC-UI-02 step 4 · The candidate's Notes tab (history): who moved the candidate between stages and when, newest first, with the
 * Not hired reason. Jira NH-280 (epic NH-223, amber). Lock acceptance-lock/rec-ui-02.4, a child of rec-ui-02.3 (one squashed
 * commit; it changes rec-ui-02-record.spec.ts AC-R8 only, because the tab strip now shows Notes).
 * Spec: onboarding-cards/specs/REC-UI-02-notes-tab.md (R-1 to R-5, words W-N1 to W-N7, AC-N1 to AC-N11), its check
 * REC-UI-02-notes-tab-spec-check.md (rounds 1 and 2; G-1: the class check runs after the history has drawn; G-2: R-1's items are
 * cited by their words, not their numbers), decisions D-RUI-02.22 to .30 in onboarding-cards/DECISIONS.md.
 * Backend: `GET /v1/candidates/{id}/events` on develop 31d048f (REC-15 step D). The history answer is built from api/openapi.yaml
 * `CandidateEvents` and checked against it (support/rec-ui-02/notes.ts). Where the spec is silent, cards/rec-ui-02.4.md says what
 * these tests take (T-N1 to T-N6).
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg (08:00 UTC).
 * AC-N11 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 */

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');

type Fx = { page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null; record: RecordFake | null; events: EventsFake | null };
const fxOf = (a: Fx): Fx => a;

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const BONGANI = 'cand-bongani';
const AMAHLE = 'cand-amahle';
/** The fixed page time of the harness: 19 Nov 2026 08:00 UTC, 10:00 in Johannesburg. */
const NOW = Date.UTC(2026, 10, 19, 8, 0, 0);
const ago = (ms: number) => iso(NOW - ms);

async function asRecruiter(fx: Fx, who: Who = WHO.recruiterA): Promise<void> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
}
const summaries = async (page: Page) => (await readLines(page)).map((l) => l.summary);
/** Notes is chosen and its history has drawn (lines, the empty line or the failure line). */
async function notesDrawn(page: Page): Promise<void> {
  await expect(eventsOf(page).first().or(main(page).getByText(NW.empty, { exact: true })).or(main(page).getByText(NW.failed, { exact: true })).first()).toBeVisible();
}

// ================================================================ AC-N1 The tab (R-1)
test.describe('AC-N1 The tab', () => {
  test.beforeEach(noBackendOnly);

  test('AC-N1 The tab strip shows Overview then Notes, no count, Overview chosen; no history read until Notes is chosen; Notes reads once (also when chosen twice) while its loading look shows; the Overview cards hide while Notes shows and come back with no read', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, record, events } = fx;
    const errors = watchErrors(page);
    events!.set(BONGANI, [added(ago(10 * DAY)), moved(ago(9 * DAY), 'APPLIED', 'INTERVIEW', 'Naledi Zungu')]);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await quiet(page);
    expect(await tabNames(page)).toEqual([NW.overview, NW.notes]);
    await expect(main(page).locator('.pp-tabs__count'), 'no count on any tab').toHaveCount(0);
    await expect(tab(page, NW.overview)).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, NW.notes)).not.toHaveAttribute('aria-selected', 'true');
    await expect(nextStepCard(page)).toBeVisible();
    await expect(detailsCard(page)).toBeVisible();
    expect(events!.reads().length, 'no history read until Notes is chosen').toBe(0);

    // While the history reads, pp-timeline's own loading look shows (S-3).
    events!.refuse({ hold: true });
    await tab(page, NW.notes).click();
    await expect.poll(() => events!.heldCount).toBe(1);
    await expect(tab(page, NW.notes)).toHaveAttribute('aria-selected', 'true');
    const region = await notesRegion(page);
    await expect(region, 'one region labelled by the Notes tab').toHaveCount(1);
    await expect(region.locator('pp-timeline .pp-skeleton').first(), 'pp-timeline\'s loading look').toBeVisible();
    events!.release();
    await expect.poll(() => summaries(page)).toEqual([movedLine('Bongani', 'INTERVIEW', 'Naledi Zungu'), addedLine('Bongani')]);
    await expect(region.locator('ol.pp-timeline')).toHaveAttribute('aria-label', historyFor('Bongani Mthembu'));
    await expect(region.locator('.pp-timeline__event')).toHaveCount(2);
    await expect(nextStepCard(page), 'the Overview cards are not shown while Notes is chosen').toBeHidden();
    await expect(detailsCard(page)).toBeHidden();
    await quiet(page);
    expect(events!.reads(BONGANI)).toHaveLength(1);

    // R-2: the same sign-in header as the record read, `limit` 200, and nothing from the address bar but the id.
    const call = events!.reads(BONGANI)[0]!;
    expect(call.authorization).toBe(record!.reads(BONGANI).at(-1)!.authorization);
    expect(call.query).toEqual({ limit: '200' });

    // Back on Overview: the cards again and no read; Notes again: the kept history and still one read.
    await chooseOverview(page);
    await expect(nextStepCard(page)).toBeVisible();
    await expect(detailsCard(page)).toBeVisible();
    await expect(timeline(page), 'no history while Overview is chosen').toBeHidden();
    await chooseNotes(page);
    await expect.poll(() => summaries(page)).toEqual([movedLine('Bongani', 'INTERVIEW', 'Naledi Zungu'), addedLine('Bongani')]);
    await chooseNotes(page);
    await quiet(page);
    expect(events!.reads(BONGANI), 'choosing Notes twice reads once (the history is kept)').toHaveLength(1);
    expect(errors, 'no console error').toEqual([]);
  });

  test('AC-N1 Switching candidate in the same tab with no reload: the next candidate opens on Overview, Notes reads that candidate and shows only its lines, and a held answer for the first candidate drawn after the switch shows nothing', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, events } = fx;
    // Names that appear only in one candidate's history.
    const A1 = [moved(ago(3 * DAY), 'APPLIED', 'INTERVIEW', 'Lindiwe Peters')];
    const A2 = [moved(ago(2 * DAY), 'APPLIED', 'APPLIED', null), added(ago(4 * DAY)), moved(ago(DAY), 'APPLIED', 'SCREENING', 'Precious Mwale')];
    events!.set(BONGANI, A1);
    events!.set(AMAHLE, A2);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await chooseNotes(page);
    await expect.poll(() => summaries(page)).toEqual([movedLine('Bongani', 'INTERVIEW', 'Lindiwe Peters')]);

    // A1, Notes drawn, then A2 in the same tab.
    await inApp(page, AMAHLE);
    await expect.poll(async () => (await personHeader(page).count()) && (await readHeader(page)).name).toBe('Amahle Dlamini');
    await expect(tab(page, NW.overview), 'A2 opens on Overview').toHaveAttribute('aria-selected', 'true');
    await expect(detailsCard(page)).toBeVisible();
    await quiet(page);
    expect(await page.content(), 'nothing of A1\'s history on A2\'s page').not.toContain('Lindiwe Peters');
    expect(events!.reads(AMAHLE), 'A2\'s history is not read before Notes is chosen').toHaveLength(0);
    await chooseNotes(page);
    await expect.poll(() => summaries(page)).toEqual([movedLine('Amahle', 'SCREENING', 'Precious Mwale'), movedLine('Amahle', 'APPLIED'), addedLine('Amahle')]);
    expect(events!.reads(AMAHLE)).toHaveLength(1);
    expect(await page.content()).not.toContain('Lindiwe Peters');

    // Back to A1 (its kept history was dropped, so Notes reads again); hold that answer, switch to A2, then let it come.
    await inApp(page, BONGANI);
    await expect.poll(async () => (await personHeader(page).count()) && (await readHeader(page)).name).toBe('Bongani Mthembu');
    await expect(tab(page, NW.overview)).toHaveAttribute('aria-selected', 'true');
    events!.refuse({ hold: true, id: BONGANI });
    await tab(page, NW.notes).click();
    await expect.poll(() => events!.heldCount).toBe(1);
    expect(events!.reads(BONGANI), 'a new id dropped the kept history, so A1 is read again').toHaveLength(2);
    await inApp(page, AMAHLE);
    await expect.poll(async () => (await personHeader(page).count()) && (await readHeader(page)).name).toBe('Amahle Dlamini');
    await expect(tab(page, NW.overview)).toHaveAttribute('aria-selected', 'true');
    events!.release();
    await quiet(page);
    expect(await page.content(), 'the late A1 answer draws nothing').not.toContain('Lindiwe Peters');
    await expect(eventsOf(page)).toHaveCount(0);
    await chooseNotes(page);
    await expect.poll(() => summaries(page)).toEqual([movedLine('Amahle', 'SCREENING', 'Precious Mwale'), movedLine('Amahle', 'APPLIED'), addedLine('Amahle')]);
    await quiet(page);
    expect(await page.content()).not.toContain('Lindiwe Peters');
    expect(await summaries(page)).toHaveLength(3);
  });
});

// ================================================================ AC-N1a Fresh after a change (R-1, M-2)
test.describe('AC-N1a Fresh after a change', () => {
  test.beforeEach(noBackendOnly);

  test('AC-N1a With Notes showing, a saved Move reads the history again at once and the new move line shows; Notes stays chosen', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, hire, events } = fx;
    events!.set(AMAHLE, [added(ago(3 * DAY))]);
    await asRecruiter(fx);
    await openRecord(page, AMAHLE);
    await chooseNotes(page);
    await expect.poll(() => summaries(page)).toEqual([addedLine('Amahle')]);
    expect(events!.reads(AMAHLE)).toHaveLength(1);
    await pageButton(page, RW.move).click();
    const d = moveDialog(page, 'Amahle Dlamini');
    await expect(d).toBeVisible();
    await chooseStage(d, 'Screening');
    await reason(d).fill('Phone screen booked');
    await moveButton(d).click();
    await expect.poll(() => hire!.to('PUT', /\/stage$/).map((c) => c.status)).toEqual([200]);
    await expect.poll(() => summaries(page), { message: 'the move just saved shows, once' }).toEqual([movedLine('Amahle', 'SCREENING', WHO.recruiterA.full), addedLine('Amahle')]);
    expect(events!.reads(AMAHLE)).toHaveLength(2);
    await expect(tab(page, NW.notes)).toHaveAttribute('aria-selected', 'true');
    const line = (await readLines(page))[0]!;
    expect(line.change).toMatchObject({ from: 'Applied', to: 'Screening' });
  });

  test('AC-N1a With Overview showing, a saved Not hired makes the next choice of Notes read again and show the Not hired line with its reason', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, events } = fx;
    events!.set(BONGANI, [moved(ago(9 * DAY), 'APPLIED', 'INTERVIEW', 'Naledi Zungu')]);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await chooseNotes(page);
    await expect.poll(() => summaries(page)).toEqual([movedLine('Bongani', 'INTERVIEW', 'Naledi Zungu')]);
    await chooseOverview(page);
    const readsBefore = events!.reads(BONGANI).length;
    await pageButton(page, RW.notHired).click();
    const d = page.getByRole('dialog', { name: 'Bongani not hired', exact: true });
    await d.getByRole('radio', { name: 'Did not attend', exact: true }).check();
    await d.getByRole('button', { name: RW.recordNotHired, exact: true }).click();
    await expect.poll(async () => (await readHeader(page)).lozenge?.words).toBe(RW.notHired);
    await chooseNotes(page);
    await expect.poll(() => summaries(page)).toEqual([notHiredLine('Bongani', WHO.recruiterA.full), movedLine('Bongani', 'INTERVIEW', 'Naledi Zungu')]);
    expect(events!.reads(BONGANI).length, 'Notes read the history again after the save').toBeGreaterThan(readsBefore);
    expect((await readLines(page))[0]).toMatchObject({ detail: reasonLine('Did not attend'), change: null });
  });
});

// ================================================================ AC-N2 Newest first, grouped by day (R-4)
test.describe('AC-N2 Newest first, grouped by day', () => {
  test.use({ timezoneId: 'UTC' });
  test.beforeEach(noBackendOnly);

  test('AC-N2 Three days: "Today" then the older dates, newest first inside each day; "{n} min ago" and "{n} hour(s) ago" today, "3 Nov 2026, 15:05" on older days; title the exact SAST time, datetime the row\'s `at`; a row with no `at` last, with no time (browser in UTC)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, events } = fx;
    const rows = {
      a: moved(ago(20 * MIN), 'OFFER', 'INTERVIEW', 'Naledi Zungu'), // 09:40 SAST
      b: moved(ago(65 * MIN), 'INTERVIEW', 'OFFER', 'Thandi Dube'), // 08:55 SAST
      c: moved(ago(3 * HOUR), 'SCREENING', 'INTERVIEW', null), // 07:00 SAST
      d: moved('2026-11-17T13:05:00.000Z', 'APPLIED', 'SCREENING', 'Precious Mwale'), // 17 Nov 15:05 SAST
      e: listChange('2026-11-17T09:20:00.000Z', 'SCREENING', 'APPLIED'), // 17 Nov 11:20 SAST
      f: added('2026-11-03T10:00:00.000Z'), // 3 Nov 12:00 SAST
      g: moved(null, 'APPLIED', 'HIRED', 'Farai Chikwanha'),
    };
    events!.set(BONGANI, Object.values(rows));
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await chooseNotes(page);
    await notesDrawn(page);
    const B = 'Bongani';
    const days = await readDays(page);
    expect(days.map((x) => x.day), 'day headings, newest first').toEqual([NW.today, '17 Nov 2026', '3 Nov 2026']);
    expect(days[0]!.lines).toEqual([movedLine(B, 'INTERVIEW', 'Naledi Zungu'), movedLine(B, 'OFFER', 'Thandi Dube'), movedLine(B, 'INTERVIEW')]);
    expect(days[1]!.lines).toEqual([movedLine(B, 'SCREENING', 'Precious Mwale'), listLine(B, 'APPLIED')]);
    expect(days[2]!.lines, 'the row with no time comes last, after every dated row').toEqual([addedLine(B), movedLine(B, 'HIRED', 'Farai Chikwanha')]);
    const lines = await readLines(page);
    expect(lines.slice(0, 6).map((l) => [l.time, l.title, l.datetime])).toEqual([
      ['20 min ago', '19 Nov 2026, 09:40', rows.a.at],
      ['1 hour ago', '19 Nov 2026, 08:55', rows.b.at],
      ['3 hours ago', '19 Nov 2026, 07:00', rows.c.at],
      ['17 Nov 2026, 15:05', '17 Nov 2026, 15:05', rows.d.at],
      ['17 Nov 2026, 11:20', '17 Nov 2026, 11:20', rows.e.at],
      ['3 Nov 2026, 12:00', '3 Nov 2026, 12:00', rows.f.at],
    ]);
    expect([lines[6]!.time, lines[6]!.title || '', lines[6]!.datetime || ''], 'no time, exact time or datetime for a row with no `at`').toEqual(['', '', '']);
    expect(sastExact(rows.d.at!)).toBe('17 Nov 2026, 15:05');
  });
});

// ================================================================ AC-N3 Each line's words (R-3, R-4, W-N2 to W-N5)
test.describe('AC-N3 Each line\'s words', () => {
  test.beforeEach(noBackendOnly);

  test('AC-N3 One row of each kind gives exactly its words: move with and without a name, stage list move (also to Not hired), Not hired with and without a name and with an unknown reason, Reopen, same stage, unknown from, no from, unknown to, added', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, record, events } = fx;
    // firstName is trimmed (the words table: `{first name}` is `firstName` from the record, trimmed).
    record!.set(BONGANI, { firstName: '  Bongani ' });
    const t = (h: number) => ago(h * HOUR);
    events!.set(BONGANI, [
      moved(t(1), 'APPLIED', 'SCREENING', 'Naledi Zungu'),
      moved(t(2), 'SCREENING', 'INTERVIEW', null),
      listChange(t(3), 'SCREENING', 'INTERVIEW'),
      listChange(t(4), 'INTERVIEW', 'NOT_HIRED'),
      notHired(t(5), 'INTERVIEW', 'WITHDREW', 'Thandi Dube'),
      notHired(t(6), 'SCREENING', 'ROLE_CLOSED', null),
      notHired(t(7), 'APPLIED', MARK.unknownCode, 'Thandi Dube'),
      moved(t(8), 'NOT_HIRED', 'INTERVIEW', 'Naledi Zungu'),
      moved(t(9), 'SCREENING', 'SCREENING', 'Naledi Zungu'),
      moved(t(9.2), 'EVALUATION', 'OFFER', 'Naledi Zungu'),
      moved(t(9.4), null, 'HIRED', null),
      moved(t(9.5), 'APPLIED', 'PROVISIONING', 'Naledi Zungu'),
      moved(t(9.6), 'APPLIED', null, 'Naledi Zungu'),
      added(t(9.8)),
    ]);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await chooseNotes(page);
    await notesDrawn(page);
    const B = 'Bongani';
    const hidden = `${NW.changeLabel} ${NW.changeTo}`;
    const change = (from: string, to: string) => ({ from, to, hidden });
    const name = (n: string, initials: string) => ({ bold: n, marker: { avatar: initials, icon: false } });
    const none = { bold: null, marker: { avatar: null, icon: true } };
    const lines = await readLines(page);
    const want = [
      { summary: movedLine(B, 'SCREENING', 'Naledi Zungu'), ...name('Naledi Zungu', 'NZ'), change: change('Applied', 'Screening'), detail: null },
      { summary: movedLine(B, 'INTERVIEW'), ...none, change: change('Screening', 'Interview'), detail: null },
      { summary: listLine(B, 'INTERVIEW'), ...none, change: change('Screening', 'Interview'), detail: null },
      // M-5: the old-system list change to Not hired is a stage list line, not a Not hired line.
      { summary: listLine(B, 'NOT_HIRED'), ...none, change: change('Interview', 'Not hired'), detail: null },
      { summary: notHiredLine(B, 'Thandi Dube'), ...name('Thandi Dube', 'TD'), change: null, detail: reasonLine('Candidate withdrew') },
      { summary: notHiredLine(B), ...none, change: null, detail: reasonLine('Role closed') },
      { summary: notHiredLine(B, 'Thandi Dube'), ...name('Thandi Dube', 'TD'), change: change('Applied', 'Not hired'), detail: null },
      { summary: movedLine(B, 'INTERVIEW', 'Naledi Zungu'), ...name('Naledi Zungu', 'NZ'), change: change('Not hired', 'Interview'), detail: null },
      // S-6: the same stage on both sides leaves out the from-to detail.
      { summary: movedLine(B, 'SCREENING', 'Naledi Zungu'), ...name('Naledi Zungu', 'NZ'), change: null, detail: null },
      { summary: movedLine(B, 'OFFER', 'Naledi Zungu'), ...name('Naledi Zungu', 'NZ'), change: null, detail: null },
      { summary: movedLine(B, 'HIRED'), ...none, change: null, detail: null },
      { summary: addedLine(B), ...none, change: null, detail: null },
    ];
    expect(lines.map(({ summary, bold, marker, change: c, detail }) => ({ summary, bold, marker, change: c, detail }))).toEqual(want);
    const text = await timeline(page).innerText();
    expect(text, 'an unknown `to` draws no line').not.toMatch(/PROVISIONING|Provisioning/);
    expect(text, 'no raw stage key').not.toMatch(/\b(APPLIED|SCREENING|INTERVIEW|OFFER|HIRED|NOT_HIRED|EVALUATION)\b/);
    expect(text, 'no "null" or "undefined"').not.toMatch(/\b(null|undefined|NaN|Invalid Date)\b/);
  });
});

// ================================================================ AC-N4 Each change once (R-3, D-RUI-02.23)
test.describe('AC-N4 Each change once', () => {
  test.beforeEach(noBackendOnly);

  test('AC-N4 A move written as a stage-history row and a talent-flow.workflow CandidateMoved, and a Not hired also sent as CandidateNotHired, show one line each; interview, offer, sentiment, SLA and rule rows show nothing', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, events } = fx;
    const m = ago(5 * HOUR), n = ago(2 * HOUR);
    const never: Row[] = [
      other(m, 'CandidateMoved', SOURCE.workflow, { from: 'APPLIED', to: 'SCREENING', by_name: 'Naledi Zungu' }),
      other(n, 'CandidateNotHired', SOURCE.workflow, { from: 'SCREENING', to: 'NOT_HIRED', reason_code: 'DID_NOT_ATTEND', by_name: 'Thandi Dube' }),
      other(n, 'CandidateMoved', SOURCE.workflow, { from: 'SCREENING', to: 'NOT_HIRED', reason_code: 'DID_NOT_ATTEND', by_name: 'Thandi Dube' }),
      other(ago(4 * HOUR), 'CandidateMoved', SOURCE.interviews, { from: 'SCREENING', to: 'INTERVIEW' }),
      other(ago(4 * HOUR), 'CandidateMoved', 'talent-flow.sla', { from: 'SCREENING', to: 'OFFER' }),
      other(ago(4.5 * HOUR), 'InterviewScheduled', SOURCE.workflow),
      ...['INTERVIEW_BOOKED', 'INTERVIEW_RESCHEDULED', 'INTERVIEW_CANCELLED', 'INTERVIEW_DONE', 'INTERVIEW_MARKED_DONE', 'INTERVIEW_DID_NOT_HAPPEN', 'INTERVIEW_EVENT_NOT_SENT']
        .map((k, i) => other(ago((3 + i / 10) * HOUR), k, SOURCE.interviews)),
      other(ago(3.8 * HOUR), 'OfferCreated', 'talent-flow.offers', { by_name: 'Precious Mwale' }),
      other(ago(3.7 * HOUR), 'OfferSent', 'talent-flow.offers'),
      other(ago(3.6 * HOUR), 'SentimentScored', 'talent-flow.sentiment'),
      other(ago(3.5 * HOUR), 'SlaBreached', 'talent-flow.sla'),
      other(ago(3.4 * HOUR), 'RuleTriggered', 'talent-flow.rules'),
    ];
    events!.set(BONGANI, [moved(m, 'APPLIED', 'SCREENING', 'Naledi Zungu'), notHired(n, 'SCREENING', 'DID_NOT_ATTEND', 'Thandi Dube'), ...never]);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await chooseNotes(page);
    await notesDrawn(page);
    await quiet(page);
    expect(await summaries(page)).toEqual([notHiredLine('Bongani', 'Thandi Dube'), movedLine('Bongani', 'SCREENING', 'Naledi Zungu')]);
    expect(await timeline(page).innerText()).not.toMatch(/Precious Mwale|Offer|Interview|interview/);
  });
});

// ================================================================ AC-N5 Never drawn (R-5)
test.describe('AC-N5 Never drawn', () => {
  test.beforeEach(noBackendOnly);

  test('AC-N5 Marker text in by, actor, by_kind, tenant_id, eventId, source, reason, detail (values and keys), candidateId and an unknown reason_code never reaches the tab, the page title or any attribute', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, events } = fx;
    // Every row carries the markers (support/rec-ui-02/notes.ts `rowOf`); `reason` holds free text on every row, `detail` a note
    // and a marker key, the added row's detail an email.
    events!.set(BONGANI, [
      added(ago(10 * DAY)),
      moved(ago(9 * DAY), 'APPLIED', 'SCREENING', 'Naledi Zungu'),
      listChange(ago(8 * DAY), 'SCREENING', 'INTERVIEW'),
      notHired(ago(3 * DAY), 'INTERVIEW', 'CHOSE_ANOTHER', 'Thandi Dube'),
      notHired(ago(2 * DAY), 'INTERVIEW', MARK.unknownCode, null),
      moved(ago(DAY), 'NOT_HIRED', 'INTERVIEW', 'Naledi Zungu'),
      other(ago(DAY), 'CandidateNotHired', SOURCE.workflow, { reason_code: MARK.unknownCode, reason: MARK.reason }),
    ]);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await chooseNotes(page);
    await notesDrawn(page);
    await quiet(page);
    expect(await eventsOf(page).count(), 'the history drew').toBe(6);
    const html = await page.content();
    for (const [field, v] of Object.entries(MARK)) expect(html, `${field} ("${v}") is drawn somewhere, text or attribute`).not.toContain(v);
    expect(html, '`source` is never drawn').not.toContain('talent-flow');
    const region = await notesRegion(page);
    const regionHtml = await region.evaluate((el) => el.outerHTML);
    expect(regionHtml, '`candidateId` is never drawn in the tab').not.toContain(BONGANI);
    const title = await page.title();
    for (const v of [...Object.values(MARK), 'talent-flow', BONGANI]) expect(title).not.toContain(v);
    expect(await timeline(page).innerText(), 'only approved reason labels').toContain(reasonLine('Chose another candidate'));
  });
});

// ================================================================ AC-N6 Paging (R-2, S-1, S-2)
test.describe('AC-N6 Paging', () => {
  test.beforeEach(noBackendOnly);

  test('AC-N6 A history over three pages is read in three calls, each sending back the token exactly (it holds +, / and =), and drawn newest first as one list: a page-one move newer than page two\'s rows comes first', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, record, events } = fx;
    // As on the server: the events table's pages run oldest first, stage-history rows come on page one only. The page-one moves
    // (7 days and 1 day ago) are newer than the page-two row (12 days ago), so neither page order nor reversed page order passes.
    events!.setPages(BONGANI,
      [moved(ago(7 * DAY), 'APPLIED', 'SCREENING', 'Naledi Zungu'), moved(ago(DAY), 'SCREENING', 'INTERVIEW', 'Thandi Dube')],
      [
        [other(ago(14 * DAY), 'SlaBreached', 'talent-flow.sla'), other(ago(13 * DAY), 'RuleTriggered', 'talent-flow.rules')],
        [added(ago(12 * DAY)), other(ago(11 * DAY), 'SentimentScored', 'talent-flow.sentiment')],
        [other(ago(6 * DAY), 'CandidateMoved', SOURCE.workflow, { from: 'APPLIED', to: 'SCREENING' }), other(ago(2 * DAY), 'CandidateMoved', SOURCE.workflow, { from: 'SCREENING', to: 'INTERVIEW' })],
      ]);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await chooseNotes(page);
    await notesDrawn(page);
    await quiet(page);
    expect(await summaries(page)).toEqual([movedLine('Bongani', 'INTERVIEW', 'Thandi Dube'), movedLine('Bongani', 'SCREENING', 'Naledi Zungu'), addedLine('Bongani')]);
    const calls = events!.reads(BONGANI);
    expect(calls.map((c) => c.status), 'three reads, each answered (a token not sent back exactly gets 400)').toEqual([200, 200, 200]);
    expect(calls[0]!.query).toEqual({ limit: '200' });
    for (const c of calls.slice(1)) {
      expect(Object.keys(c.query).sort()).toEqual(['limit', 'nextToken']);
      expect(c.query['limit']).toBe('200');
      expect(c.query['nextToken']).toMatch(/\+.*\/.*=$/);
      expect(c.raw.split('\n')[0], 'the token is sent through encodeURIComponent').toMatch(/nextToken=[^&\s]*%2B[^&\s]*%2F[^&\s]*%3D/);
    }
    const auth = record!.reads(BONGANI).at(-1)!.authorization;
    for (const c of calls) expect(c.authorization).toBe(auth);
  });

  test('AC-N6 An answer that keeps sending nextToken stops after 10 reads and draws what it has', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, events } = fx;
    events!.setPages(BONGANI, [moved(ago(DAY), 'APPLIED', 'INTERVIEW', 'Naledi Zungu')], [[added(ago(9 * DAY))]]);
    events!.endless.add(BONGANI);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await chooseNotes(page);
    await expect.poll(() => events!.reads(BONGANI).length).toBeGreaterThanOrEqual(10);
    await quiet(page);
    await page.waitForTimeout(500);
    expect(events!.reads(BONGANI), 'ten reads in all, then it stops').toHaveLength(10);
    await notesDrawn(page);
    const s = await summaries(page);
    expect(s[0]).toBe(movedLine('Bongani', 'INTERVIEW', 'Naledi Zungu'));
    expect(s.filter((x) => x === movedLine('Bongani', 'INTERVIEW', 'Naledi Zungu')), 'each row once').toHaveLength(1);
    expect(s).toContain(addedLine('Bongani'));
    await expect(main(page).getByText(NW.failed, { exact: true })).toHaveCount(0);
  });
});

// ================================================================ AC-N7 Empty and failure (R-2, W-N6, W-N7)
test.describe('AC-N7 Empty and failure', () => {
  test.beforeEach(noBackendOnly);

  test('AC-N7 An empty history shows "No history yet." in the timeline\'s empty slot', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, events } = fx;
    events!.set(BONGANI, []);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await chooseNotes(page);
    await expect(main(page).locator('.pp-timeline__empty')).toHaveText(NW.empty);
    await expect(eventsOf(page)).toHaveCount(0);
    await expect(main(page).getByText(NW.failed, { exact: true })).toHaveCount(0);
  });

  for (const [label, how] of [['a 500', { status: 500 }], ['a 404', { status: 404, body: { error: 'Not found' } }], ['a dropped connection', { abort: true }]] as const) {
    test(`AC-N7 ${label} shows "The history could not be loaded." with "Try again", draws no row, and "Try again" reads again and draws the history`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
      const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
      const { page, events } = fx;
      events!.set(BONGANI, [moved(ago(DAY), 'APPLIED', 'INTERVIEW', 'Naledi Zungu')]);
      await asRecruiter(fx);
      await openRecord(page, BONGANI);
      events!.refuse({ ...how });
      await chooseNotes(page);
      const region = await notesRegion(page);
      await expect(region.getByText(NW.failed, { exact: true })).toBeVisible();
      await expect(eventsOf(page)).toHaveCount(0);
      await expect(main(page).locator('.pp-timeline__empty')).toHaveCount(0);
      const before = events!.reads(BONGANI).length;
      await region.getByRole('button', { name: NW.tryAgain, exact: true }).click();
      await expect.poll(() => summaries(page)).toEqual([movedLine('Bongani', 'INTERVIEW', 'Naledi Zungu')]);
      expect(events!.reads(BONGANI).length - before).toBe(1);
      await expect(main(page).getByText(NW.failed, { exact: true })).toHaveCount(0);
    });
  }

  test('AC-N7 A 500 on page two (page one loaded) shows the failure line and draws no row; "Try again" reads again from the start and draws both pages', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, events } = fx;
    events!.setPages(BONGANI, [moved(ago(DAY), 'APPLIED', 'INTERVIEW', 'Naledi Zungu')], [[], [added(ago(9 * DAY))]]);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    events!.refuse({ page: 2, status: 500 });
    await chooseNotes(page);
    const region = await notesRegion(page);
    await expect(region.getByText(NW.failed, { exact: true })).toBeVisible();
    await quiet(page);
    await expect(eventsOf(page), 'nothing drawn, not even page one').toHaveCount(0);
    expect(events!.reads(BONGANI).map((c) => c.status)).toEqual([200, 500]);
    await region.getByRole('button', { name: NW.tryAgain, exact: true }).click();
    await expect.poll(() => summaries(page)).toEqual([movedLine('Bongani', 'INTERVIEW', 'Naledi Zungu'), addedLine('Bongani')]);
    const calls = events!.reads(BONGANI);
    expect(calls[2]!.query, 'Try again starts from page one').toEqual({ limit: '200' });
    expect(calls.map((c) => c.status)).toEqual([200, 500, 200, 200]);
  });
});

// ================================================================ AC-N8 Rows are data (R-4)
test.describe('AC-N8 Rows are data', () => {
  test.beforeEach(noBackendOnly);

  test('AC-N8 A by_name of <img src=x onerror=...> shows as text and runs nothing', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, events } = fx;
    const evil = '<img src=x onerror="window.__notesXss=1">';
    events!.set(BONGANI, [moved(ago(DAY), 'APPLIED', 'INTERVIEW', evil), notHired(ago(HOUR), 'INTERVIEW', 'OTHER', `<b id="notes-b">${'Bold'}</b>`)]);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await chooseNotes(page);
    await notesDrawn(page);
    await quiet(page);
    const lines = await readLines(page);
    expect(lines.map((l) => l.bold)).toEqual(['<b id="notes-b">Bold</b>', evil]);
    expect(lines[1]!.summary).toBe(movedLine('Bongani', 'INTERVIEW', evil));
    await expect(timeline(page).locator('img')).toHaveCount(0);
    await expect(page.locator('#notes-b')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __notesXss?: number }).__notesXss)).toBeUndefined();
  });
});

// ================================================================ AC-N8a SAST clock (R-4, M-4)
test.describe('AC-N8a SAST clock', () => {
  test.use({ timezoneId: 'UTC' });
  test.beforeEach(noBackendOnly);

  test('AC-N8a With the browser in UTC: a row at 00:30 SAST today (22:30 UTC the day before) sits under "Today"; a row at 23:30 SAST yesterday under "18 Nov 2026"; titles in SAST', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, events } = fx;
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('UTC');
    const x = moved('2026-11-18T22:30:00.000Z', 'APPLIED', 'SCREENING', 'Naledi Zungu');
    const y = moved('2026-11-18T21:30:00.000Z', 'SCREENING', 'INTERVIEW', 'Thandi Dube');
    events!.set(BONGANI, [y, x]);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await chooseNotes(page);
    await notesDrawn(page);
    expect(await readDays(page)).toEqual([
      { day: NW.today, lines: [movedLine('Bongani', 'SCREENING', 'Naledi Zungu')] },
      { day: '18 Nov 2026', lines: [movedLine('Bongani', 'INTERVIEW', 'Thandi Dube')] },
    ]);
    const lines = await readLines(page);
    expect(lines.map((l) => [l.time, l.title])).toEqual([['9 hours ago', '19 Nov 2026, 00:30'], ['18 Nov 2026, 23:30', '18 Nov 2026, 23:30']]);
  });
});

// ================================================================ AC-N8b Company B (M-3, safety)
test.describe('AC-N8b Company B', () => {
  test.beforeEach(noBackendOnly);

  test('AC-N8b A company B Recruiter (Recruitment on for this test) typing company A\'s candidate id sees only "This candidate could not be found.", no tab strip, and the history is never asked for; B\'s own candidate\'s Notes works, and the fake refuses B a read of A\'s history with 404', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, modules, events } = fx;
    events!.set(BONGANI, [moved(ago(DAY), 'APPLIED', 'INTERVIEW', 'Naledi Zungu')]);
    events!.set('cand-kagiso', [moved(ago(DAY), 'INTERVIEW', 'OFFER', 'Naledi Zungu')]);
    events!.set('cand-b1', [added(ago(2 * DAY))]);
    modules!.answers.B = ['onboarding', 'recruitment'];
    await asRecruiter(fx, WHO.recruiterB);
    for (const id of [BONGANI, 'cand-kagiso']) {
      await openRecord(page, id);
      await expect(main(page).getByText(NW.notFound, { exact: true })).toBeVisible();
      await quiet(page);
      await expect(main(page).getByRole('tablist'), `${id}: no tab strip`).toHaveCount(0);
      await expect(main(page).getByRole('tab')).toHaveCount(0);
      expect(events!.requests, `${id}: the history is never asked for`).toHaveLength(0);
      const html = await page.content();
      for (const n of ['Naledi Zungu', 'Bongani', 'Kagiso']) expect(html, `${id}: ${n}`).not.toContain(n);
    }
    // Control: B's own candidate's Notes reads B's history.
    await openRecord(page, 'cand-b1');
    await chooseNotes(page);
    await expect.poll(() => summaries(page)).toEqual([addedLine('Hlengiwe')]);
    expect(events!.reads().map((c) => [c.email, c.status])).toEqual([[WHO.recruiterB.email, 200]]);
    // The fake answers B's sign-in on A's candidate id as candidateIsOurs does: 404, no row.
    const auth = events!.reads('cand-b1')[0]!.authorization!;
    const url = events!.urls[0]!.replace('/cand-b1/', `/${BONGANI}/`);
    const answer = await page.evaluate(async ([u, a]) => { const r = await fetch(u!, { headers: { Authorization: a! } }); return { status: r.status, body: await r.text() }; }, [url, auth]);
    expect(answer.status).toBe(404);
    expect(answer.body).not.toContain('Naledi');
  });
});

// ================================================================ AC-N9 Phone (390 wide)
test.describe('AC-N9 Phone', () => {
  test.beforeEach(noBackendOnly);

  // Runs at 1280 too: standing line 4 of the lock-check rule asks for covered, clipped or cut-off items at desktop and phone width.
  test('AC-N9 At 390 wide (and at 1280) the tab strip, every day heading and every line are visible, not under the top bar, not covered, not cut off by any box around them, and the page has no sideways scroll', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, events } = fx;
    events!.set(BONGANI, [
      added('2026-11-03T10:00:00.000Z'),
      moved('2026-11-17T13:05:00.000Z', 'APPLIED', 'SCREENING', 'Nompumelelo Vilakazi-Mahlangu'),
      listChange('2026-11-17T14:05:00.000Z', 'SCREENING', 'INTERVIEW'),
      notHired(ago(3 * HOUR), 'INTERVIEW', 'NOT_RIGHT_EXPERIENCE', 'Thandi Dube'),
      moved(ago(20 * MIN), 'NOT_HIRED', 'INTERVIEW', 'Naledi Zungu'),
    ]);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await chooseNotes(page);
    await notesDrawn(page);
    await quiet(page);
    await expect(eventsOf(page)).toHaveCount(5);
    await expect(main(page).getByRole('tablist')).toBeVisible();
    const problems = await page.evaluate(async () => {
      const out: string[] = [];
      const width = document.documentElement.clientWidth;
      const bar = document.querySelector('pp-top-navigation')?.getBoundingClientRect();
      const targets = [...document.querySelectorAll<HTMLElement>('main [role="tab"], main .pp-timeline__day, main .pp-timeline__event, main .pp-timeline__summary, main .pp-timeline__detail, main .pp-timeline__time')];
      if (!targets.length) out.push('nothing to check');
      for (const el of targets) {
        // Boxes that clip (overflow hidden or clip) keep the scroll the page gave them: scrollIntoView may scroll one and hide the fault.
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
        // Cut off by a box around it: every ancestor that clips (overflow hidden or clip, or a clip-path) holds the whole item.
        for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
          const cs = getComputedStyle(a);
          if (!/hidden|clip/.test(cs.overflowX + cs.overflowY) && cs.clipPath === 'none') continue;
          const b = a.getBoundingClientRect();
          if (r.top < b.top - 1 || r.bottom > b.bottom + 1 || r.left < b.left - 1 || r.right > b.right + 1) { out.push(`${label} is cut off by ${a.tagName.toLowerCase()}.${String(a.className).split(' ')[0]}`); break; }
        }
        // Covered: the middle of the item is the item (or something inside it).
        const hit = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 1), width - 1), Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1));
        if (hit && !el.contains(hit) && !hit.contains(el)) out.push(`${label} is covered by ${hit.tagName.toLowerCase()}`);
      }
      window.scrollTo(0, 0);
      if (document.documentElement.scrollWidth > width + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide)`);
      return out;
    });
    expect(problems).toEqual([]);
  });
});

// ================================================================ AC-N10 Kit match (pp-timeline, S-4, G-1)
test.describe('AC-N10 Kit match', () => {
  test.beforeEach(noBackendOnly);

  const DS = join(__dirname, '..', '..', 'src', 'styles', 'design-system');
  const known = (): Set<string> => new Set(['components.css', 'tokens/base.css'].flatMap((f) => readFileSync(join(DS, f), 'utf8').match(/\.pp-[a-z0-9_-]+/g) ?? []).map((c: string) => c.slice(1)));
  /** The kit example "Candidate history, grouped by day" and what pp-timeline itself draws for this step (S-4). */
  const ALLOWED = [
    /^pp-timeline$/, /^pp-timeline__(day|event|marker|content|summary|detail|time)$/, /^pp-avatar$/, /^pp-avatar--[a-z]+$/,
    /^pp-timeline__icon$/, /^pp-timeline__empty$/, /^pp-visually-hidden$/, /^pp-skeleton/,
  ];
  const MUST = ['pp-timeline', 'pp-timeline__day', 'pp-timeline__event', 'pp-timeline__marker', 'pp-timeline__content', 'pp-timeline__summary', 'pp-timeline__detail', 'pp-timeline__time', 'pp-avatar'];

  async function timelineParts(page: Page) {
    return main(page).locator('pp-timeline').first().evaluate((root) => {
      const all = [root, ...root.querySelectorAll('*')];
      return {
        classes: [...new Set(all.flatMap((e) => [...e.classList]).filter((c) => c.startsWith('pp-')))],
        other: [...new Set(all.flatMap((e) => [...e.classList]).filter((c) => !/^(pp-|ng-|lucide)/.test(c)))],
        styled: all.filter((e) => e.hasAttribute('style') && !/^(--[\w-]+:[^;]*;?\s*)+$/.test(e.getAttribute('style') ?? '')).map((e) => e.tagName.toLowerCase()),
      };
    });
  }

  test('AC-N10 Once the history has drawn (G-1), the Notes tab\'s pp-timeline uses only the kit example\'s classes and what pp-timeline draws (icon, empty, hidden change words, avatar colours); every class exists in the design system; no other class or style', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h, record: _r, events: _e });
    const { page, events } = fx;
    events!.set(BONGANI, [added(ago(10 * DAY)), moved(ago(9 * DAY), 'APPLIED', 'INTERVIEW', 'Naledi Zungu'), moved(ago(2 * HOUR), 'INTERVIEW', 'OFFER', null), notHired(ago(HOUR), 'OFFER', 'WITHDREW', 'Thandi Dube')]);
    events!.set(AMAHLE, []);
    await asRecruiter(fx);
    await openRecord(page, BONGANI);
    await chooseNotes(page);
    await expect(eventsOf(page)).toHaveCount(4);
    await quiet(page);
    const have = known();
    const p = await timelineParts(page);
    expect(p.classes.filter((c) => !ALLOWED.some((re) => re.test(c))), 'classes outside the kit example and pp-timeline\'s own').toEqual([]);
    expect(MUST.filter((c) => !p.classes.includes(c)), 'the kit example\'s parts are all there').toEqual([]);
    expect(p.classes.filter((c) => !have.has(c)), 'every pp-* class exists in the design system').toEqual([]);
    expect(p.other, 'no class outside the design system').toEqual([]);
    expect(p.styled, 'no style attribute that sets a look').toEqual([]);
    // The empty state: the same rule.
    await openRecord(page, AMAHLE);
    await chooseNotes(page);
    await expect(main(page).locator('.pp-timeline__empty')).toBeVisible();
    const e = await timelineParts(page);
    expect(e.classes.filter((c) => !ALLOWED.some((re) => re.test(c)))).toEqual([]);
    expect(e.other).toEqual([]);
  });
});

// ================================================================ AC-N11 pepla-dev (judged after merge)
test.describe('AC-N11 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-N11 runs on pepla-dev only.');
  const DEV = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-07', 'dev-ids.json'), 'utf8')) as { candidate: string };

  test('AC-N11 @pepla-dev The company A Recruiter opens the REC-07 seeded candidate, chooses Notes, and sees the seeded history row: the mover\'s name in bold and "moved Rec to Interview"', async ({ page, signIn, hr }) => {
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto(`/hire/candidates/${DEV.candidate}`);
    await expect(personHeader(page)).toBeVisible();
    await chooseNotes(page);
    await notesDrawn(page);
    await expect(main(page).getByText(NW.failed, { exact: true })).toHaveCount(0);
    // Other dev runs can add rows, so the test looks for the seeded line, not an exact list.
    const line = (await readLines(page)).find((l) => / moved Rec to Interview$/.test(l.summary));
    expect(line, 'a line "{name} moved Rec to Interview"').toBeTruthy();
    expect(line!.bold, 'the mover\'s name, from by_name').toBeTruthy();
    expect(line!.summary).toBe(`${line!.bold} moved Rec to Interview`);
    expect(line!.change).toMatchObject({ from: 'Applied', to: 'Interview' });
    test.info().annotations.push({ type: 'record', description: page.url() });
  });

  test('AC-N11 @pepla-dev Company B\'s HR login opening that candidate\'s address sees "This candidate could not be found." (Recruitment on) or is sent away (off), and no history on screen. A skip here is not a pass', async ({ page, signIn }) => {
    const email = process.env['E2E_B_HR_EMAIL'], password = process.env['E2E_B_HR_PASSWORD'];
    test.skip(!email || !password, 'E2E_B_HR_EMAIL and E2E_B_HR_PASSWORD are not set: the company B part cannot run (a skip is not a pass).');
    await signIn.open();
    await signIn.signInAs({ email: email!, password: password! });
    await expect(page).toHaveURL('/hr');
    await openNav(page);
    const recruitmentOn = (await navLabels(page)).includes('Candidates');
    await page.goto(`/hire/candidates/${DEV.candidate}`);
    await quiet(page);
    if (recruitmentOn) await expect(main(page).getByText(NW.notFound, { exact: true })).toBeVisible();
    else await expect(page).toHaveURL('/hr');
    await expect(main(page).getByRole('tab', { name: NW.notes, exact: true })).toHaveCount(0);
    await expect(timeline(page)).toHaveCount(0);
    const html = await page.content();
    for (const n of ['Seed-Score', 'moved Rec']) expect(html).not.toContain(n);
  });
});
