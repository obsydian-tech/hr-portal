import type { MeFake, Person } from '../onb-05/me-fake';

/**
 * ONB-19: the `step` that GET /v1/me answers, layered over ONB-05's stand-in (support/onb-05/me-fake.ts, locked, not edited).
 *
 * `answer(who)` is what the stand-in sends for GET /v1/me. This puts one key on top of it, `step`, taken from the person:
 *   - `step` not set on the person: the answer has no `step` key at all (the API before this card; every earlier test).
 *   - `step: null`: the key is there and its value is null (an archived or unknown record).
 *   - one of the four codes: that code.
 * Nothing else in the answer is touched, so `documentsDue` and every other field are whatever ONB-05 / ONB-10's stand-in sends.
 * Canned answers (`nextGets`) still win, as for every other test, so a 403, a 404, a 5xx or "no answer" is as before.
 */
export type StepCode = 'INVITED' | 'DOCUMENTS' | 'IN_REVIEW' | 'VERIFIED';
export type StepValue = StepCode | null | undefined;
export type StepPerson = Person & { step?: StepValue };

export const STEP_CODES: StepCode[] = ['INVITED', 'DOCUMENTS', 'IN_REVIEW', 'VERIFIED'];

export function giveSteps(me: MeFake): void {
  const base = me.answer.bind(me);
  me.answer = (who: Person) => {
    const answer = base(who);
    return 'step' in who && (who as StepPerson).step !== undefined ? { ...answer, step: (who as StepPerson).step } : answer;
  };
}
