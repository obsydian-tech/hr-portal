/**
 * Child lock int-01.1 (INT-01, NH-269): what older locked suites need now that INT-01 changes the booking and action routes.
 *
 * - The booking body is INT-01 rule 1's (the old body is refused, rule 1 and R-9); the PATCH takes an `action` and its reason
 *   (rule 7; the "add panel" branch is gone, R-4); both routes take an `Idempotency-Key` header (R-22), and scheduleInterview needs
 *   the `IDEMPOTENCY_TABLE` setting (500 without it, R-22).
 * - These older worlds keep their interview at 2026-12-01 09:00 UTC and run on the real clock. Cancel is only allowed before the start
 *   and Mark as done only after it (rules 8 and 10), so the PATCH fixture is a cancel before that time and a Mark as done after it. Both
 *   answer 200 and write, as the old `complete` did.
 */
export const INT01_SETTINGS = { IDEMPOTENCY_TABLE: 'talent-flow-idempotency-keys' };
/** A fixed request key for a fixture (each run starts from a fresh copy of the tables). */
export const int01Key = (name: string) => ({ 'Idempotency-Key': `int01-1-fixture-${name}` });
/** A right INT-01 booking far in the future, on these panel people. */
export const int01Booking = (panel: string[]) => ({ type: 'TECHNICAL', at: '2030-01-15T09:00:00Z', length_minutes: 60, where: 'IN_PERSON', place: 'Room 1', panel });
/** The closing action an interview that starts at `at` accepts now: cancel before the start, Mark as done after it. */
export const int01Close = (at = '2026-12-01T09:00:00.000Z') => (Date.now() < Date.parse(at)
  ? { action: 'cancel', reason: 'CANDIDATE_ASKED' }
  : { action: 'complete', reason: 'FEEDBACK_GIVEN_ANOTHER_WAY' });
