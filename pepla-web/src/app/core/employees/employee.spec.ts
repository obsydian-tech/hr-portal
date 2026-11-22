import { countBySteps, isOverdue, matchesSearch, orderNewEmployees, stepOfCode, toNewEmployee, type NewEmployee } from './employee';

const person = (name: string, startDate: string, step: NewEmployee['step'] = 'Invited'): NewEmployee => ({ id: name, name, email: '', department: '', step, startDate, documentsDue: '', hrPartner: '' });

describe('stepOfCode', () => {
  it('turns the four API codes into the four words', () => {
    expect(stepOfCode('INVITED')).toBe('Invited');
    expect(stepOfCode('DOCUMENTS')).toBe('Documents');
    expect(stepOfCode('IN_REVIEW')).toBe('In review');
    expect(stepOfCode('VERIFIED')).toBe('Verified');
  });
  it('gives no step for any other value or none', () => {
    for (const other of ['', 'ACTIVE', 'invited', 'toString', '__proto__']) expect(stepOfCode(other)).toBeNull();
    expect(stepOfCode(null)).toBeNull();
    expect(stepOfCode(undefined)).toBeNull();
  });
});

describe('toNewEmployee', () => {
  it('drops phone and ID digits', () => {
    const p = toNewEmployee({ employee_id: 'e1', first_name: 'A', last_name: 'B', phone: '+27 82 000 0000', id_number_last4: '1234' } as never);
    expect(JSON.stringify(p)).not.toMatch(/0000|1234/);
  });
});

describe('orderNewEmployees', () => {
  it('puts upcoming first (soonest), then earlier (latest first), then none; ties by name', () => {
    const list = [person('Zed', ''), person('Old', '2026-01-01'), person('Recent', '2026-11-12'), person('Beta', '2026-11-20'), person('Alpha', '2026-11-20'), person('Today', '2026-11-13')];
    expect(orderNewEmployees(list, '2026-11-13').map((p) => p.name)).toEqual(['Today', 'Alpha', 'Beta', 'Recent', 'Old', 'Zed']);
  });
});

describe('countBySteps', () => {
  it('counts each step and leaves people with no step out', () => {
    expect(countBySteps([person('a', '', 'Invited'), person('b', '', 'Verified'), person('c', '', null)])).toEqual({ Invited: 1, Documents: 0, 'In review': 0, Verified: 1 });
  });
});

describe('matchesSearch', () => {
  it('matches part of a name or email in any case', () => {
    const p = { ...person('Pieter van Wyk', ''), email: 'pvw.ops@gmail.com' };
    expect(matchesSearch(p, 'VAN WYK')).toBe(true);
    expect(matchesSearch(p, '@gmail')).toBe(true);
    expect(matchesSearch(p, 'zzz')).toBe(false);
    expect(matchesSearch(p, '  ')).toBe(true);
  });
});

describe('isOverdue', () => {
  const late = (step: NewEmployee['step'], documentsDue = '2026-11-16') => ({ ...person('a', '2026-11-23', step), documentsDue });
  it('is for a person at Invited or Documents whose date has passed', () => {
    expect(isOverdue(late('Invited'), '2026-11-17')).toBe(true);
    expect(isOverdue(late('Documents'), '2026-11-17')).toBe(true);
  });
  it('is never for a person with HR, verified, with no step, due today, due later or with no date', () => {
    expect(isOverdue(late('In review'), '2026-11-17')).toBe(false);
    expect(isOverdue(late('Verified'), '2026-11-17')).toBe(false);
    expect(isOverdue(late(null), '2026-11-17')).toBe(false);
    expect(isOverdue(late('Documents', '2026-11-17'), '2026-11-17')).toBe(false);
    expect(isOverdue(late('Documents', '2026-11-18'), '2026-11-17')).toBe(false);
    expect(isOverdue(late('Documents', ''), '2026-11-17')).toBe(false);
  });
});
