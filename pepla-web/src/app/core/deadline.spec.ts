import { deadlineOf, isPast } from './deadline';

describe('deadlineOf', () => {
  const cases: Array<[string, string, string, string, number]> = [
    ['2026-11-29', '2026-11-17', 'later', 'Due in 12 days', 12],
    ['2026-11-21', '2026-11-17', 'later', 'Due in 4 days', 4],
    ['2026-11-20', '2026-11-17', 'soon', 'Due in 3 days', 3],
    ['2026-11-18', '2026-11-17', 'soon', 'Due in 1 day', 1],
    ['2026-11-17', '2026-11-17', 'today', 'Due today', 0],
    ['2026-11-16', '2026-11-17', 'overdue', 'Overdue by 1 day', -1],
    ['2026-11-15', '2026-11-17', 'overdue', 'Overdue by 2 days', -2],
    ['2027-01-02', '2026-12-30', 'soon', 'Due in 3 days', 3],
    ['2028-03-01', '2028-02-28', 'soon', 'Due in 2 days', 2],
  ];
  for (const [due, today, state, words, days] of cases) {
    it(`${due} on ${today} is ${words}`, () => {
      expect(deadlineOf(due, today)).toEqual(expect.objectContaining({ state, words, days }));
    });
  }
  it('writes the date as 24 Nov 2026', () => {
    expect(deadlineOf('2026-11-24', '2026-11-17')?.dateText).toBe('24 Nov 2026');
  });
  it('gives nothing for a date that is not one', () => {
    for (const bad of ['', 'soon', '2026-02-30', '2026-13-01', '2026-11-1', '2026-11-24T10:00:00Z', undefined, null]) expect(deadlineOf(bad, '2026-11-17')).toBeNull();
  });
  it('says whether a date has passed', () => {
    expect(isPast('2026-11-16', '2026-11-17')).toBe(true);
    expect(isPast('2026-11-17', '2026-11-17')).toBe(false);
    expect(isPast('', '2026-11-17')).toBe(false);
  });
});
