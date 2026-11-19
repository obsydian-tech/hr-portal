import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reminderEmail } from './reminder-email.mjs';
import { typesToGive } from './required-documents.mjs';

const URL = 'https://people.example/sign-in';

describe('reminderEmail', () => {
  const m = reminderEmail({ firstName: 'Sipho', typeNames: ['National ID', 'Bank account confirmation letter'], dueIso: '2026-11-24', loginUrl: URL });
  it('has the proposed words, the date as a calendar date and the exact link', () => {
    assert.equal(m.subject, 'Your documents are due on 24 Nov 2026');
    assert.match(m.text, /Hi Sipho\. Still to upload, due 24 Nov 2026: National ID, Bank account confirmation letter\./);
    assert.match(m.text, /Sign in to Naleko People to upload your documents: https:\/\/people\.example\/sign-in\n/);
    assert.match(m.html, /Upload your documents/);
    assert.ok(m.html.includes(`href="${URL}"`));
    assert.doesNotMatch(m.html + m.text, /password/i);
  });
  it('escapes every value in the HTML', () => {
    const e = reminderEmail({ firstName: `<b>Sam</b> & "Co" O'Neil`, typeNames: ['National ID'], dueIso: '2026-11-24', loginUrl: URL });
    assert.doesNotMatch(e.html, /<b>Sam/);
    assert.match(e.html, /&lt;b&gt;Sam&lt;\/b&gt; &amp; &quot;Co&quot; O&#39;Neil/);
  });
});

describe('typesToGive', () => {
  const req = ['NATIONAL_ID', 'BANK_CONFIRMATION'];
  it('lists a required type with no file, in order', () => {
    assert.deepEqual(typesToGive([], req), req);
    assert.deepEqual(typesToGive([{ document_type: 'NATIONAL_ID', ocr_status: 'PASSED' }], req), ['BANK_CONFIRMATION']);
  });
  it('counts a PENDING row with no file as not uploaded, and a started one as uploaded', () => {
    assert.deepEqual(typesToGive([{ document_type: 'NATIONAL_ID', ocr_status: 'PENDING' }], req), req);
    assert.deepEqual(typesToGive([{ document_type: 'NATIONAL_ID', ocr_status: 'PENDING', ocr_started_at: '2026-11-20T10:00:00Z' }], req), ['BANK_CONFIRMATION']);
  });
  it('does not list a sent-back type', () => {
    assert.deepEqual(typesToGive([{ document_type: 'BANK_CONFIRMATION', ocr_status: 'FAILED' }], req), ['NATIONAL_ID']);
  });
});
