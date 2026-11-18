/**
 * What a due date says on the day (ONB-10): the state, the whole days and the words, from the date
 * the backend sent and today's date in South Africa. One function, so the checklist, HR home and
 * their tests all use the same words. No Angular here, so a plain test can call it.
 */
export type DeadlineState = 'later' | 'soon' | 'today' | 'overdue';

export interface Deadline {
  state: DeadlineState;
  /** Whole days, signed: negative when the date has passed. */
  days: number;
  /** "Due in 5 days", "Due in 1 day", "Due today", "Overdue by 2 days". */
  words: string;
  /** "24 Nov 2026". */
  dateText: string;
}

/** The design system's own rule: a deadline is soon from this many days out. */
const SOON_DAYS = 3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The day as a UTC midnight, or null when the text is not a real YYYY-MM-DD date. */
function parse(text: unknown): number | null {
  if (typeof text !== 'string') return null;
  const m = DAY.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const date = new Date(t);
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? t : null;
}

const plural = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/**
 * `due` and `today` are YYYY-MM-DD; `today` is the calendar date in Africa/Johannesburg.
 * Whole calendar days only, no time of day. Null when either is not a real date.
 */
export function deadlineOf(due: string | null | undefined, today: string): Deadline | null {
  const dueMs = parse(due);
  const todayMs = parse(today);
  if (dueMs === null || todayMs === null) return null;
  const days = Math.round((dueMs - todayMs) / 86_400_000);
  const d = new Date(dueMs);
  const dateText = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (days < 0) return { state: 'overdue', days, words: `Overdue by ${plural(-days)}`, dateText };
  if (days === 0) return { state: 'today', days, words: 'Due today', dateText };
  return { state: days <= SOON_DAYS ? 'soon' : 'later', days, words: `Due in ${plural(days)}`, dateText };
}

/** True when the date is a real one and before `today`. */
export function isPast(due: string | null | undefined, today: string): boolean {
  return deadlineOf(due, today)?.state === 'overdue';
}
