import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DOCUMENTS_DUE_DAYS_BEFORE_START, documentsDueDate, dueDaysFor } from './due-date.mjs';

describe('documentsDueDate', () => {
  it('is 7 days before the start date', () => {
    assert.equal(documentsDueDate('2026-12-01'), '2026-11-24');
  });
  it('crosses a month, a leap day and a year end', () => {
    assert.equal(documentsDueDate('2026-03-03'), '2026-02-24');
    assert.equal(documentsDueDate('2028-03-05'), '2028-02-27');
    assert.equal(documentsDueDate('2027-01-04'), '2026-12-28');
  });
  it('gives null, and never throws, for no date or a date that is not one', () => {
    for (const bad of ['', undefined, null, 'soon', '2026-02-30', '2026-13-01', '24 Nov 2026', '2026-11-1', '2026-11-24T10:00:00Z', 20261201, {}]) {
      assert.equal(documentsDueDate(bad), null, String(bad));
    }
  });
});

describe('dueDaysFor', () => {
  it('is 7 for every company', () => {
    assert.equal(DOCUMENTS_DUE_DAYS_BEFORE_START, 7);
    for (const t of ['ten_A', 'ten_B', '', undefined]) assert.equal(dueDaysFor(t), 7);
  });
});
