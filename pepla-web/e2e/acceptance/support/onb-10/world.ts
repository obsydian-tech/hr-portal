import { A, B, EMP, MAIL, ask, bodyOf, tables, type Caller } from '../ten-02/world';
import type { Row, Run, Tables } from '../ten-02/lambda-harness';

/**
 * ONB-10: TEN-02's two companies (A, also the legacy company, and B) with start dates written on their people,
 * so the real getEmployees and getMyStart can be asked as HR and as an employee of either company.
 * Names and addresses are TEN-02's made-up ones.
 */
export { A, B, EMP, MAIL, ask, bodyOf };
export type { Caller, Run };

/** The start dates the Lambda tests use: one per company, none for Jane Smith (A's second person). */
export const START = {
  a1: '2026-12-01', // due 2026-11-24
  a2: '', // no start date: no due date
  b1: '2026-03-03', // due 2026-02-24 (a month change; 2026 is not a leap year)
  legacy: '2027-01-04', // due 2026-12-28 (a year change)
} as const;

const idOf = (r: Row): string => String((r['employee_id'] as { S?: string })?.S ?? '');

/** TEN-02's tables with `planned_start_date` set on the people named (an empty text removes it). */
export function withStarts(dates: Record<string, string>, base: Tables = tables()): Tables {
  const out: Tables = { ...base };
  out['employees'] = (base['employees'] ?? []).map((r) => {
    const id = idOf(r);
    if (!(id in dates)) return r;
    const next: Row = { ...r };
    if (dates[id]) next['planned_start_date'] = { S: dates[id]! };
    else delete next['planned_start_date'];
    return next;
  });
  return out;
}

/** The world every ONB-10 Lambda test starts from. */
export const seeded = (): Tables =>
  withStarts({ [EMP.a1]: START.a1, [EMP.a2]: START.a2, [EMP.b1]: START.b1, [EMP.legacy]: START.legacy });

type Item = Record<string, unknown>;
/** The people a getEmployees answer holds, by employee_id. */
export function itemsById(run: Run): Record<string, Item> {
  const items = ((bodyOf(run) as { items?: Item[] } | null)?.items ?? []) as Item[];
  return Object.fromEntries(items.map((i) => [String(i['employee_id']), i]));
}

export const describeRun = (r: Run): string =>
  `${r.response?.statusCode} ${String(r.response?.body ?? '').slice(0, 300)}${r.error ? ` (threw ${r.error.name}: ${r.error.message.slice(0, 200)})` : ''}`;
