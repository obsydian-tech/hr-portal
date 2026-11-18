import { chipWords } from './words';

/**
 * ONB-10: calendar-day maths for the tests, written here on purpose and not imported from the app: the app's own
 * function is what AC-3 tests, and a test must not use the code it judges.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The rule: documents are due 7 days before the start date. */
export const DAYS_BEFORE_START = 7;

export const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Whole calendar days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** The due date for a start date (YYYY-MM-DD), or '' when there is none. */
export const dueFor = (start: string): string => (start ? addDays(start, -DAYS_BEFORE_START) : '');

/** "24 Nov 2026". */
export const dateText = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
};

/** Today in South Africa, as YYYY-MM-DD, for the moment `now`. */
export const johannesburgDay = (now: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(now);

export type Chip = { state: 'later' | 'soon' | 'today' | 'overdue'; days: number; words: string; dateText: string };

/** What a due date reads as on `today`: later, soon (3 days or fewer), today, overdue. */
export function chipFor(due: string, today: string): Chip {
  const n = daysBetween(today, due);
  const state = n < 0 ? 'overdue' : n === 0 ? 'today' : n <= 3 ? 'soon' : 'later';
  return { state, days: Math.abs(n), words: chipWords(state, Math.abs(n)), dateText: dateText(due) };
}

/** Overdue means: a step where the person still has something to give, and a due date before today. */
export const isOverdue = (step: string | null | undefined, due: string, today: string): boolean =>
  (step === 'INVITED' || step === 'DOCUMENTS') && !!due && due < today;
