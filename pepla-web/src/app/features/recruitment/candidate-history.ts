import type { TimelineDay, TimelineEvent } from '../../ds';
import { STAGE } from './candidate-list';
import type { CandidateEventRow } from './hire-api';
import { REASONS } from './not-hired-dialog';

/**
 * The Notes tab's history (REC-UI-02 step 4, rules R-3 and R-4): which rows of a candidate's history become lines, the words of each
 * line, and the day groups. Pure, so the page only holds the answer and the first name. Only the fields the spec names are read from a
 * row (`kind`, `source`, `at`, `by_name`, `from`, `to`, `reason_code`); `by`, `actor`, `by_kind`, `tenant_id`, `eventId`, `source`
 * text, `reason` and `detail` are never drawn.
 */

const STAGE_HISTORY = 'talent-flow.stage-history';
const SAST = 2 * 3_600_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const REASON_LABEL = new Map<string, string>(REASONS);

/** The icon beside a line with no name. `circle-dot`, the timeline's own default, is not in the app's icon registry. */
const NO_NAME_ICON = 'circle-dot-dashed' as const;

const clean = (v: string | null | undefined): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const stageName = (v: string | null | undefined): string | null => (typeof v === 'string' && Object.hasOwn(STAGE, v) ? STAGE[v]! : null);
const when = (at: string | null | undefined): number | null => { const t = typeof at === 'string' ? Date.parse(at) : NaN; return Number.isNaN(t) ? null : t; };

/** South African time, whatever the browser's own zone: the day number, "3 Nov 2026" and "15:05". */
const sastParts = (ms: number) => {
  const d = new Date(ms + SAST);
  const two = (n: number) => String(n).padStart(2, '0');
  return { day: Math.floor((ms + SAST) / 86_400_000), date: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, clock: `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}` };
};

type Line = { summary: string; actor?: string; change?: { from: string; to: string; label: string }; detail?: string };

/** One row as a line, or `null` when it is not drawn. R-3 read top down: the first matching row wins. */
function lineOf(r: CandidateEventRow, first: string): Line | null {
  const by = clean(r.by_name);
  const sentence = (to: string) => (by ? { actor: by, summary: `moved ${first} to ${to}` } : { summary: `${first} moved to ${to}`.trim() });
  if (r.kind === 'CandidateCreated') return { summary: `${first} added as a candidate`.trim() };
  if (r.kind !== 'CandidateMoved' || r.source !== STAGE_HISTORY) return null;
  const to = stageName(r.to);
  if (!to) return null;
  const from = stageName(r.from);
  const change = from && from !== to ? { from, to, label: 'Stage changed' } : undefined;
  if (r.reason_code === 'STAGE_LIST_CHANGE') return { summary: `${first} moved to ${to} when the stage list changed`.trim(), ...(change ? { change } : {}) };
  if (r.to === 'NOT_HIRED') {
    const reason = r.reason_code ? REASON_LABEL.get(r.reason_code) : undefined;
    return { ...sentence(to), ...(reason ? { detail: `Reason: ${reason}` } : change ? { change } : {}) };
  }
  return { ...sentence(to), ...(change ? { change } : {}) };
}

/** "{n} min ago" under an hour and "{n} hour(s) ago" for the rest of today, as the kit writes them. */
function ago(ms: number, now: number): string {
  const min = Math.max(1, Math.floor((now - ms) / 60_000));
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
}

export interface History { days: TimelineDay[]; /** Rows with no usable `at`: last, under no day heading, with no time. */ loose: TimelineEvent[]; }

/** The rows as day groups, newest first by `at`. */
export function historyDays(rows: readonly CandidateEventRow[], first: string, now = Date.now()): History {
  const today = sastParts(now).day;
  const lines = rows.flatMap((r) => { const line = lineOf(r, first.trim()); return line ? [{ at: when(r.at), raw: r.at, line }] : []; });
  lines.sort((a, b) => (a.at === null ? (b.at === null ? 0 : 1) : b.at === null ? -1 : b.at - a.at));
  const days: TimelineDay[] = [];
  const noTime: TimelineEvent[] = [];
  for (const { at, raw, line } of lines) {
    const base = { ...(line.actor ? { actor: line.actor } : { icon: NO_NAME_ICON }), summary: line.summary, ...(line.change ? { change: line.change } : {}), ...(line.detail ? { detail: line.detail } : {}) };
    if (at === null) { noTime.push({ ...base, when: '', at: '', exact: '' }); continue; }
    const p = sastParts(at);
    const heading = p.day === today ? 'Today' : p.date;
    const event: TimelineEvent = { ...base, when: p.day === today ? ago(at, now) : `${p.date}, ${p.clock}`, at: raw as string, exact: `${p.date}, ${p.clock}` };
    const last = days[days.length - 1];
    if (last && last.day === heading) last.events.push(event); else days.push({ day: heading, events: [event] });
  }
  return { days, loose: noTime };
}
