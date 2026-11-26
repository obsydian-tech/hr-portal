/**
 * Child lock int-01.1 (INT-01, NH-269) for rec-07.spec.ts AC-1: scheduling is INT-01's booking now (rule 1: the old body is refused;
 * R-22: a request key; the interview id is the server's). A vote is accepted only once the interview has started (rule 14), and a
 * booking must be in the future (D-T1), so the test books ahead of NOW and then moves the stored start to before NOW ("time passes").
 */
import { ask, bodyOf, NOW, type Caller, type Run, type Tables } from '../rec-07/world';
import { INT01_SETTINGS, int01Key } from './fixtures';

let n = 0;
/** Books a TECHNICAL interview the INT-01 way for `cand` on `panel`, a day after NOW. */
export function bookInt01(who: Caller, cand: string, panel: string[], t: Tables): Run {
  n += 1;
  const at = new Date(Date.parse(NOW) + 86_400_000).toISOString();
  return ask('scheduleInterview', who, { method: 'POST', route: '/v1/candidates/{id}/interviews', path: { id: cand }, headers: int01Key(`rec07-${n}`),
    body: { type: 'TECHNICAL', at, length_minutes: 60, where: 'IN_PERSON', place: 'Room 1', panel } } as any, t, { env: INT01_SETTINGS });
}
/** The interview id a booking answered with. */
export const bookedId = (r: Run): string => String(bodyOf(r)?.interview_id ?? '');
/** A copy of `t` where interview `iv` of `cand` started an hour before NOW. */
export function started(t: Tables, state: string, cand: string, iv: string): Tables {
  const out = structuredClone(t);
  const at = new Date(Date.parse(NOW) - 3_600_000).toISOString();
  out[state] = (out[state] ?? []).map((r: any) => (r?.PK?.S === `CANDIDATE#${cand}` && r?.SK?.S === `INTERVIEW#${iv}` ? { ...r, scheduledAt: { S: at } } : r));
  return out;
}
