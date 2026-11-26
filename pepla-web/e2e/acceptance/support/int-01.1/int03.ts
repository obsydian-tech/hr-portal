/**
 * Child lock int-01.1 (INT-01, NH-269) for int-03.spec.ts AC-3, which pins each run to develop 7048cb9's answer, rows and events.
 * INT-01 changes two things on the REC-07 guest path, and only these are allowed through:
 * - The guest read answers `open` (INT-01 AC-24): true on these runs, whose interview started on 20 Nov (runs R1 and R7).
 * - A guest vote may write one extra row beside its vote to stop the same vote landing twice (INT-01 AC-27(d) judges it as one vote):
 *   a row on the same candidate whose SK starts with `VOTED#` and names the interview (run R4). Any other new row still fails.
 */
type Same = { body?: any; rows?: string[]; [k: string]: unknown };
const OPEN_RUNS = new Set(['R1', 'R7']);
export function int01Expected(id: string, expected: unknown): unknown {
  const e = structuredClone(expected) as Same;
  if (OPEN_RUNS.has(id) && e?.body && typeof e.body === 'object') e.body = { ...e.body, open: true };
  return e;
}
export function int01Actual(id: string, actual: unknown): unknown {
  const a = structuredClone(actual) as Same;
  if (id === 'R4' && Array.isArray(a?.rows)) a.rows = a.rows.filter((r) => !/^\+ talent-flow-state \{"PK":"CANDIDATE#[^"]+","SK":"VOTED#iv-rec07-a-1#/.test(r));
  return a;
}
