import { describe, expect, it } from 'vitest';
import { formatDate, mask, plural } from './format';
import { dateProblem, parseDate } from './forms/date-picker/date-picker';

describe('house formats', () => {
  const now = new Date(2026, 10, 11);
  it('drops the year when it is this year', () => expect(formatDate(new Date(2026, 10, 3), { now })).toBe('3 Nov'));
  it('shows the year when asked or when it differs', () => {
    expect(formatDate(new Date(2026, 10, 17), { now, year: true })).toBe('17 Nov 2026');
    expect(formatDate(new Date(2027, 0, 5), { now })).toBe('5 Jan 2027');
  });
  it('masks all but the last four', () => expect(mask('9005145124087')).toBe('•••••••••4087'));
  it('pluralises', () => { expect(plural(1, 'day')).toBe('1 day'); expect(plural(3, 'day')).toBe('3 days'); });
});

describe('typed dates', () => {
  const day = (d: Date | null) => d && [d.getFullYear(), d.getMonth() + 1, d.getDate()];
  it('reads the house format and common South African ways of writing a date', () => {
    expect(day(parseDate('23 Nov 2026'))).toEqual([2026, 11, 23]);
    expect(day(parseDate('23 November 2026'))).toEqual([2026, 11, 23]);
    expect(day(parseDate('23/11/2026'))).toEqual([2026, 11, 23]);
    expect(day(parseDate('2026-11-23'))).toEqual([2026, 11, 23]);
  });
  it('refuses dates that do not exist', () => {
    expect(parseDate('31 Nov 2026')).toBeNull();
    expect(parseDate('30/02/2026')).toBeNull();
    expect(parseDate('soon')).toBeNull();
  });
});

describe('typed date problems', () => {
  it('says how many days the month has', () => expect(dateProblem('31 Nov 2026')).toBe('November has 30 days. Check the date, for example 30 Nov 2026.'));
  it('knows leap years', () => expect(dateProblem('29/02/2027')).toBe('February has 28 days. Check the date, for example 28 Feb 2027.'));
  it('shows the format for anything else', () => expect(dateProblem('next Tuesday')).toBe('Enter the date like this: 23 Nov 2026.'));
  it('has nothing to say about a real date', () => expect(dateProblem('23 Nov 2026')).toBeNull());
});
