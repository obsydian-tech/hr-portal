import { countBySteps, matchesSearch, orderNewEmployees, stepOfStage, toNewEmployee, type NewEmployee } from './employee';

const person = (name: string, startDate: string, step: NewEmployee['step'] = 'Invited'): NewEmployee => ({ id: name, name, email: '', department: '', step, startDate, hrPartner: '' });

describe('stepOfStage', () => {
  it('maps today\'s stored stages to the four steps', () => {
    expect(stepOfStage('INVITED')).toBe('Invited');
    expect(stepOfStage('ACTIVE')).toBe('Documents');
    expect(stepOfStage('DOCUMENTS_SUBMITTED')).toBe('In review');
    for (const s of ['VERIFIED', 'TRAINING', 'ONBOARDED']) expect(stepOfStage(s)).toBe('Verified');
  });
  it('gives no step for an unknown or empty stage', () => {
    expect(stepOfStage('ARCHIVED')).toBeNull();
    expect(stepOfStage('')).toBeNull();
    expect(stepOfStage(undefined)).toBeNull();
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
