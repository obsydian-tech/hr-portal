import { toEmployeeDetail } from './employee-detail';
import { RISK_WORD } from './risk-words';

const base = { employee_id: 'e1', first_name: 'Kagiso', last_name: 'Molefe' };

describe('risk words', () => {
  it('gives every band its own words and tone', () => {
    const texts = Object.values(RISK_WORD).map((w) => w.text);
    expect(new Set(texts).size).toBe(4);
  });
  it('reads the three risk keys for HR and none for the employee', () => {
    const hr = toEmployeeDetail({ employee: { ...base, risk_band: 'HIGH', risk_reason: 'r', risk_assessed_at: '2026-11-18T08:30:00.000Z' } });
    expect(hr.risk).toEqual({ band: 'HIGH', reason: 'r', assessedAt: '2026-11-18T08:30:00.000Z' });
    expect(toEmployeeDetail({ employee: { ...base, risk_band: null, risk_reason: null, risk_assessed_at: null } }).risk?.band).toBeNull();
    expect(toEmployeeDetail({ employee: base }).risk).toBeNull();
  });
  it('treats an unknown band as no band', () => {
    expect(toEmployeeDetail({ employee: { ...base, risk_band: 'ODD' } }).risk?.band).toBeNull();
  });
});
