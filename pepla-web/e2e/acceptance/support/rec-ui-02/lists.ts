import type { Locator, Page } from '@playwright/test';
import { expect, iso, type Cand, type Co, type HireFake } from '../rec-ui/harness';

/**
 * REC-UI-02 step 1 (the lists) helpers: the words of the two list screens, the table read from the page, and the extra
 * candidates some tests add to the harness world. Spec: onboarding-cards/specs/REC-UI-02.md rule 2, AC-1, AC-2, AC-11 to
 * AC-15; the list answer is REC-15 step A (api/openapi.yaml CandidateList). Notes: ../../cards/rec-ui-02.md.
 * Nothing here calls Bedrock or any paid AI.
 */

// ---------------------------------------------------------------- the words (kit text, approved lines, settled U-1, U-7)
export const W = {
  candidates: 'Candidates',
  candidatesLine: 'Find anyone who applied, in any stage.',
  pipeline: 'Pipeline',
  caption: 'Candidates, most urgent first',
  search: 'Search by name, email or role',
  allRoles: 'All roles',
  allStages: 'All stages',
  moreFilters: 'More filters',
  failed: 'Candidates could not be loaded.',
  tryAgain: 'Try again',
  empty: 'No one yet',
  columns: ['Candidate', 'Stage', 'Stage time', 'Applied'],
  tabs: ['All', 'My candidates', 'Overdue', 'Due soon'],
  /** The tabs the kit's phone screens draw (My candidates is left out there). */
  phoneTabs: ['All', 'Overdue', 'Due soon'],
  stages: ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Not hired'],
} as const;
export const STAGE_WORD: Record<string, string> = { APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview', OFFER: 'Offer', HIRED: 'Hired', NOT_HIRED: 'Not hired' };

// ---------------------------------------------------------------- the table

export type Row = { name: string; initials: string; meta: string; stage: string; time: string; tone: 'danger' | 'warning' | 'lozenge' | 'text' | 'none'; applied: string };

export const table = (page: Page): Locator => page.locator('main').getByRole('table', { name: W.caption, exact: true });

/** Every row of the list as a person reads it, in order. Columns by their header, so a build may order nothing else. */
export async function readRows(page: Page): Promise<Row[]> {
  const t = table(page);
  if ((await t.count()) === 0) return [];
  return t.evaluate((el) => {
    const heads = [...el.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').replace(/\s+/g, ' ').trim());
    const col = (tr: Element, name: string) => tr.querySelectorAll('td')[heads.indexOf(name)] ?? null;
    const text = (n: Element | null | undefined) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return [...el.querySelectorAll('tbody tr')].filter((tr) => tr.querySelectorAll('td').length > 1).map((tr) => {
      const who = col(tr, 'Candidate');
      const time = col(tr, 'Stage time');
      const loz = time?.querySelector('.pp-lozenge');
      const tone = loz ? (loz.classList.contains('pp-lozenge--danger') ? 'danger' : loz.classList.contains('pp-lozenge--warning') ? 'warning' : 'lozenge') : text(time) ? 'text' : 'none';
      return {
        name: text(who?.querySelector('.pp-person__name')), initials: text(who?.querySelector('.pp-avatar')), meta: text(who?.querySelector('.pp-person__meta')),
        stage: text(col(tr, 'Stage')), time: text(time), tone, applied: text(col(tr, 'Applied')),
      } as const;
    });
  }) as Promise<Row[]>;
}

export const names = async (page: Page): Promise<string[]> => (await readRows(page)).map((r) => r.name);

/** Scrolls to the end of the list until no more rows come (the next page loads at the end of the list, D-RUI-02.5). */
export async function scrollToEnd(page: Page, rounds = 8): Promise<void> {
  let before = -1;
  for (let i = 0; i < rounds; i++) {
    const n = (await readRows(page)).length;
    if (n === before) return;
    before = n;
    await table(page).locator('tbody tr').last().scrollIntoViewIfNeeded().catch(() => undefined);
    await page.mouse.wheel(0, 20_000);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  }
}

/** The list requests the fake got, in order. */
export const listCalls = (hire: HireFake) => hire.to('GET', /\/v1\/candidates$/);

// ---------------------------------------------------------------- the data the seed gives company A (harness.ts, rec-ui-01.3)

/** Company A's open and Hired candidates in the server's order, with the words each row must show at 19 Nov 2026 10:00 SAST.
 *  Applied is the answer's `applied_at`, not the day the row entered its stage (Bongani and Kagiso differ; lock check B4). */
export const A_ALL: Array<Omit<Row, 'initials'>> = [
  { name: 'Bongani Mthembu', meta: 'Fleet controller · Mid', stage: 'Interview', time: 'Overdue by 2 days', tone: 'danger', applied: '4 Nov 2026' },
  { name: 'Tendai Ncube', meta: 'Fleet controller · Mid', stage: 'Interview', time: 'Due today', tone: 'warning', applied: '18 Nov 2026' },
  { name: 'Vusi Naidoo', meta: 'Senior accountant · Mid', stage: 'Interview', time: 'Due in 1 day', tone: 'warning', applied: '18 Nov 2026' },
  { name: 'Amahle Dlamini', meta: 'Fleet controller · Mid', stage: 'Applied', time: 'On track, 3 days left', tone: 'text', applied: '18 Nov 2026' },
  { name: 'Tariro Moyo', meta: 'Fleet controller · Mid', stage: 'Screening', time: 'On track, 3 days left', tone: 'text', applied: '18 Nov 2026' },
  { name: 'Ayanda Mkhize', meta: 'Fleet controller · Mid', stage: 'Screening', time: 'On track, 4 days left', tone: 'text', applied: '17 Nov 2026' },
  { name: 'Kagiso Molefe', meta: 'Fleet controller · Mid', stage: 'Offer', time: 'On track, 4 days left', tone: 'text', applied: '28 Oct 2026' },
  { name: 'Karabo Jacobs', meta: 'Senior accountant · Mid', stage: 'Applied', time: 'On track, 4 days left', tone: 'text', applied: '18 Nov 2026' },
  { name: 'Ntombi Dlamini', meta: 'Senior accountant · Mid', stage: 'Screening', time: 'On track, 4 days left', tone: 'text', applied: '18 Nov 2026' },
  { name: 'Lwazi Buthelezi', meta: 'Warehouse supervisor · Mid', stage: 'Applied', time: 'On track, 4 days left', tone: 'text', applied: '18 Nov 2026' },
  { name: 'Zanele Pillay', meta: 'Warehouse supervisor · Mid', stage: 'Screening', time: 'On track, 4 days left', tone: 'text', applied: '18 Nov 2026' },
  { name: 'Pule Maseko', meta: 'Warehouse supervisor · Mid', stage: 'Interview', time: 'On track, 4 days left', tone: 'text', applied: '18 Nov 2026' },
  { name: 'Dineo Kruger', meta: 'Warehouse supervisor · Mid', stage: 'Offer', time: 'On track, 4 days left', tone: 'text', applied: '18 Nov 2026' },
];
export const initialsOf = (name: string) => name.split(' ').map((w) => w[0]).join('');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A candidate of company A on Senior accountant (or none), for the tests that need a row the seed does not have. */
export function extra(now: number, id: string, name: string, stage: Cand['stage'], over: Partial<Cand> = {}): Cand {
  return {
    id, name, stage, role_id: 'role-accountant', level: 'MID', email: `${id}@example.org`, stage_entered_at: iso(now - DAY), due_at: iso(now + 4 * DAY), sla_status: 'ON_TRACK', ...over,
  };
}

/**
 * The stage-time words, one row per case the server can send (REC-15 rule 1 and the decisions in cards/rec-ui-02.md):
 * [the row, the words, the look]. Clock: 19 Nov 2026 10:00 in Johannesburg.
 */
export function clockCases(now: number): Array<[Cand, string, Row['tone']]> {
  return [
    [extra(now, 'cand-k1', 'Lindiwe Overdue', 'OFFER', { sla_status: 'OVERDUE', due_at: iso(now - DAY) }), 'Overdue by 1 day', 'danger'],
    [extra(now, 'cand-k2', 'Musa Overdue', 'INTERVIEW', { sla_status: 'OVERDUE', due_at: iso(now - 5 * DAY) }), 'Overdue by 5 days', 'danger'],
    // Due at 08:00 today and now 10:00: late on the same day.
    [extra(now, 'cand-k3', 'Thabo Late', 'APPLIED', { sla_status: 'OVERDUE', due_at: iso(now - 2 * HOUR) }), 'Overdue', 'danger'],
    [extra(now, 'cand-k4', 'Nandi Today', 'SCREENING', { sla_status: 'DUE_SOON', due_at: iso(now + 5 * HOUR) }), 'Due today', 'warning'],
    [extra(now, 'cand-k5', 'Sizwe Soon', 'OFFER', { sla_status: 'DUE_SOON', due_at: iso(now + 2 * DAY) }), 'Due in 2 days', 'warning'],
    // 23:30 UTC on 20 Nov is 01:30 on 21 Nov in Johannesburg: two calendar days away there, one in UTC.
    [extra(now, 'cand-k6', 'Zodwa Midnight', 'INTERVIEW', { sla_status: 'DUE_SOON', due_at: '2026-11-20T23:30:00.000Z' }), 'Due in 2 days', 'warning'],
    [extra(now, 'cand-k7', 'Lerato Track', 'INTERVIEW', { sla_status: 'ON_TRACK', due_at: iso(now + DAY) }), 'On track, 1 day left', 'text'],
    [extra(now, 'cand-k8', 'Jabu Track', 'APPLIED', { sla_status: 'ON_TRACK', due_at: iso(now + 6 * HOUR) }), 'On track', 'text'],
    [extra(now, 'cand-k9', 'Precious Track', 'SCREENING', { sla_status: 'ON_TRACK', due_at: iso(now + 9 * DAY) }), 'On track, 9 days left', 'text'],
    // No hours set for the stage: the server sends no due date and on track (REC-15 D-T-A1).
    [extra(now, 'cand-k10', 'Kabelo Noclock', 'SCREENING', { sla_status: 'ON_TRACK', due_at: null }), '', 'none'],
    // Hired: the server sends no clock at all.
    [extra(now, 'cand-k11', 'Sibusiso Hired', 'HIRED', { stage_entered_at: iso(now - 3 * DAY) }), '', 'none'],
  ];
}

/** `n` more open candidates of company A on Senior accountant, after every seeded row in the server's order. */
export function many(now: number, n: number): Cand[] {
  return Array.from({ length: n }, (_, i) => {
    const k = String(i + 1).padStart(3, '0');
    return extra(now, `cand-p${k}`, `Paging Person${k}`, 'APPLIED', { due_at: iso(now + 6 * DAY + i * 60_000) });
  });
}

/** Turns Recruitment on for another company in the fake modules answer. */
export const recruitmentOn = (answers: Record<Co, string[]>, co: Co) => { answers[co] = ['onboarding', 'recruitment']; };

/** The query a list request sent, without the page token. */
export const queryOf = (q: Record<string, string>) => Object.fromEntries(Object.entries(q).filter(([k]) => k !== 'nextToken'));

export { expect };
