// House formats (project/readme.md, Content): "3 Nov", "17 Nov 2026", "Thu 13 Nov 2026, 10:00".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const toDate = (d: Date | string) => (d instanceof Date ? d : new Date(d));
const pad = (n: number) => String(n).padStart(2, '0');

/** "3 Nov", or "3 Nov 2026" when the year differs from `now` (or `year` is true). */
export function formatDate(d: Date | string, opts: { year?: boolean; weekday?: boolean; time?: boolean; now?: Date } = {}) {
  const x = toDate(d);
  const now = opts.now ?? new Date();
  const withYear = opts.year ?? x.getFullYear() !== now.getFullYear();
  let s = `${x.getDate()} ${MONTHS[x.getMonth()]}${withYear ? ` ${x.getFullYear()}` : ''}`;
  if (opts.weekday) s = `${DAYS[x.getDay()]} ${s}`;
  if (opts.time) s += `, ${pad(x.getHours())}:${pad(x.getMinutes())}`;
  return s;
}

/** ISO for a <time datetime>: date only, or date and time. */
export const isoDate = (d: Date | string, time = false) => {
  const x = toDate(d);
  const day = `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  return time ? `${day}T${pad(x.getHours())}:${pad(x.getMinutes())}` : day;
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Whole calendar days from `now` to `d` (negative when past). */
export const daysBetween = (now: Date, d: Date) => Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000);
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Masks all but the last `keep` characters: "•••••••••0876". */
export const mask = (value: string, keep = 4) => '•'.repeat(Math.max(0, value.length - keep)) + value.slice(-keep);
