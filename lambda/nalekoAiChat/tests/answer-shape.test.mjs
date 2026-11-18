import { checksOf } from '../answer-shape.mjs';

const call = (employee_id, documents, extra = {}) => ({
  toolName: 'list_verifications',
  toolArgs: { employee_id },
  result: { documents },
  isError: false,
  ...extra,
});

describe('checksOf', () => {
  it('gives the ID row then the bank row, newest upload wins, missing when absent', () => {
    const rows = checksOf([call('EMP-1', [
      { document_id: 'a', document_type: 'NATIONAL_ID', check: 'DOESNT_MATCH', arrived_at: '2026-11-01T10:00:00Z' },
      { document_id: 'b', document_type: 'NATIONAL_ID', check: 'MATCHES', arrived_at: '2026-11-02T10:00:00Z' },
    ])]);
    expect(rows).toEqual([
      { label: 'ID document', result: 'Matches' },
      { label: 'Bank letter', result: 'Missing' },
    ]);
  });

  it('shows a document still being read as Being checked', () => {
    const rows = checksOf([call('EMP-1', [{ document_id: 'a', document_type: 'NATIONAL_ID', check: 'READING', arrived_at: null }])]);
    expect(rows[0]).toEqual({ label: 'ID document', result: 'Being checked' });
  });

  it('adds no row for an unknown type and never shows an unknown check as Matches', () => {
    const rows = checksOf([call('EMP-1', [
      { document_id: 'a', document_type: 'SOMETHING_ELSE', check: 'MATCHES' },
      { document_id: 'b', document_type: 'BANK_CONFIRMATION', check: 'WHATEVER' },
    ])]);
    expect(rows).toEqual([
      { label: 'ID document', result: 'Missing' },
      { label: 'Bank letter', result: 'Needs a look' },
    ]);
  });

  it('gives nothing for no call, a failed call, several people, or a call without employee_id', () => {
    expect(checksOf([])).toBeUndefined();
    expect(checksOf([call('EMP-1', [], { isError: true })])).toBeUndefined();
    expect(checksOf([call('EMP-1', []), call('EMP-2', [])])).toBeUndefined();
    expect(checksOf([{ toolName: 'list_verifications', toolArgs: {}, result: { documents: [] }, isError: false }])).toBeUndefined();
  });
});
