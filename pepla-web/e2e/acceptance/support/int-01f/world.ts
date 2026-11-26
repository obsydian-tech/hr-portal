import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileOf } from '../rec-04/world';
import { CLOCK } from '../rec-15/world';
import { HANDLER, IDEM_TABLE, RACE_FILE, apiEvent, av, newKey, plain, rowsOf, type O, type Req, type Run, type Tables } from '../int-01/world';

/**
 * INT-01.F (NH-281): what this card's tests add to INT-01's world (support/int-01/world.ts, unchanged). Nothing here is application code.
 *
 * - hooks.mjs (a preload next to this file) fires on each of several matching DynamoDB calls, not only the first (INT-01's race.mjs runs
 *   its second request once), can change a row directly (no real request can move `sequence` after a vote lands, spec AC-4), can make
 *   one watched call fail (a request key left RUNNING), and can run a second request at another time (a take-over 121 seconds later).
 * - withHooks() turns a list of hooks into run settings for INT-01's call(); fires() reads back what each fire did.
 */
export const HOOKS_FILE = join(__dirname, 'hooks.mjs');

export type Raw = { table: string; key: Record<string, unknown>; set?: Record<string, unknown>; remove?: string[] };
export type HookRun = { req: Req; now?: string } | { raw: Raw } | { fail: true };
export type Hook = { when: 'before' | 'after'; on?: 'write' | 'read'; match: string; table?: string; skip?: number; times?: number; runs: HookRun[] };

const WRITE_ROUTES = new Set(['POST /v1/candidates/{id}/interviews', 'PATCH /v1/candidates/{id}/interviews/{interviewId}']);
/** A write route's request with an Idempotency-Key header (a fresh one unless the request names one). */
const keyed = (q: Req): Req => {
  if (!WRITE_ROUTES.has(q.route)) return q;
  if (Object.keys(q.headers ?? {}).some((h) => h.toLowerCase() === 'idempotency-key')) return q;
  return { ...q, headers: { ...(q.headers ?? {}), 'Idempotency-Key': newKey() } };
};
const runOf = (r: HookRun) => ('req' in r ? { handler: fileOf(HANDLER[r.req.route]!), event: apiEvent(keyed(r.req)), ...(r.now ? { now: r.now } : {}) } : r);

/** Run settings that load hooks.mjs (after REC-15's clock and INT-01's race.mjs) with these hooks. */
export function withHooks(hooks: Hook[], o: O = {}): O {
  return {
    ...o,
    env: {
      ...(o.env ?? {}),
      NODE_OPTIONS: [CLOCK, RACE_FILE, HOOKS_FILE].map((f) => `--import=${pathToFileURL(f).href}`).join(' '),
      INT01F_HOOKS: JSON.stringify(hooks.map((h) => ({ ...h, runs: h.runs.map(runOf) }))),
    },
  };
}

/** Each fire of a run: its calls and (for a second request) its answer, in order. */
export function fires(r: Run): { calls: any[]; response?: any; error?: any }[] {
  const out: { calls: any[]; response?: any; error?: any }[] = [];
  let cur: { calls: any[]; response?: any; error?: any } | null = null;
  for (const c of r.calls as any[]) {
    if (c.service === 'race-start') { cur = { calls: [] }; continue; }
    if (c.service === 'race') { if (cur) { cur.response = c.response; cur.error = c.error; out.push(cur); } cur = null; continue; }
    if (cur) cur.calls.push(c);
  }
  return out;
}
/** A fire as a Run (its answer, its calls, the tables at the end). */
export const fireRun = (r: Run, i: number): Run => { const f = fires(r)[i]; return { response: f?.response?.raw ? undefined : f?.response, error: f?.error, calls: f?.calls ?? [], tables: r.tables }; };

/** The request-key rows (plain values). */
export const keyRows = (t: Tables) => rowsOf(t, IDEM_TABLE);
/** The tables with the request-key rows replaced by `rows` (plain values). */
export function withKeyRows(t: Tables, rows: Record<string, unknown>[]): Tables {
  const out = structuredClone(t);
  out[IDEM_TABLE] = rows.map((r) => av(Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))));
  return out;
}
export { plain };
