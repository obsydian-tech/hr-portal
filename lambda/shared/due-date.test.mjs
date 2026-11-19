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

describe('reminder window (ONB-21)', async () => {
  const { REMINDER_DAYS_BEFORE_DUE, daysBetween, reminderDue, todayInJohannesburg } = await import('./due-date.mjs');
  it('names 2 days', () => assert.equal(REMINDER_DAYS_BEFORE_DUE, 2));
  it('takes today from the Johannesburg calendar', () => {
    assert.equal(todayInJohannesburg(new Date('2026-11-18T22:30:00Z')), '2026-11-19');
    assert.equal(todayInJohannesburg(new Date('2026-11-18T21:59:00Z')), '2026-11-18');
  });
  it('counts whole days across a month, a year and a leap day', () => {
    assert.equal(daysBetween('2026-11-22', '2026-11-24'), 2);
    assert.equal(daysBetween('2026-12-31', '2027-01-02'), 2);
    assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2);
    assert.equal(daysBetween('2026-11-24', '2026-11-22'), -2);
  });
  it('is due from 2 days before up to the due date, never after', () => {
    assert.equal(reminderDue('2026-11-24', '2026-11-21'), false);
    for (const today of ['2026-11-22', '2026-11-23', '2026-11-24']) assert.equal(reminderDue('2026-11-24', today), true, today);
    assert.equal(reminderDue('2026-11-24', '2026-11-25'), false);
  });
  it('is false, and never throws, for a null, malformed or impossible date', () => {
    for (const bad of [null, undefined, '', 'soon', '2026-02-30', 20261124]) {
      assert.equal(reminderDue(bad, '2026-11-22'), false);
      assert.equal(reminderDue('2026-11-24', bad), false);
    }
  });
});
