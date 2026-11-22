import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactNumbers, hasNumberRun, NUMBER_RUN, REPLACEMENT } from './pii-redact.mjs';

// Made-up shapes only; none is a real number.
const REMOVED = [
  'Account No: 62123456789',
  'Acc 6212345678',
  'Account 6212 3456 789',
  'Acc 6212-3456-789',
  'Acc 6212–3456–789',
  'Acc 6212/3456/789',
  'Acc 62,123,456,789',
  'Tel +27 82 123 4567',
  'Tel 082.123.4567',
  'Tel 0821234567',
  'ID 9013015009087',
  'ID 900101 5009 087',
  'Card 4111 1111 1111 1111',
  'Acc 1234567890123',
  'Acc 621234567890',
  'Split 6212\n3456\n789',
  'Split 6212\r\n3456\r\n789',
  'Nbsp 6212 3456 789',
  'Zero-width 6212​3456​789',
  'Full-width ６２１２３４５６７８９',
  'Glued AC6212345678y',
  'Passport A1234567 end',
];

const KEPT = ['Page 3 of 12', '18 November 2026', 'R 1 500', 'Hello world', ''];

test('numbers are removed and the words around them stay', () => {
  for (const s of REMOVED) {
    const out = redactNumbers(s);
    assert.ok(out.includes(REPLACEMENT), 'not replaced: shape #' + REMOVED.indexOf(s));
    assert.equal(hasNumberRun(out), false);
    assert.ok(/^[A-Za-z-]+/.test(out) || out.startsWith(REPLACEMENT));
  }
  assert.equal(redactNumbers('Account 6212345678 does not match the letter'), `Account ${REPLACEMENT} does not match the letter`);
});

test('words and short numbers are kept', () => {
  for (const s of KEPT) assert.equal(redactNumbers(s), s);
});

test('a column gap of four characters is not joined', () => {
  assert.equal(redactNumbers('12345    67890'), '12345    67890');
});

test('non-strings give an empty string', () => {
  for (const v of [null, undefined, 12345678, {}, []]) assert.equal(redactNumbers(v), '');
});

test('redacting twice changes nothing; hasNumberRun agrees', () => {
  for (const s of [...REMOVED, ...KEPT]) {
    const once = redactNumbers(s);
    assert.equal(redactNumbers(once), once);
    assert.equal(hasNumberRun(once), false);
  }
  for (const s of REMOVED.filter((x) => !/Passport|Glued/.test(x))) assert.equal(hasNumberRun(s), true);
  for (const s of KEPT) assert.equal(hasNumberRun(s), false);
});

test('repeat calls give the same answer (no lastIndex leak)', () => {
  const t = 'Acc 6212345678';
  assert.deepEqual([hasNumberRun(t), hasNumberRun(t), hasNumberRun('none'), hasNumberRun(t)], [true, true, false, true]);
  assert.ok(NUMBER_RUN instanceof RegExp);
});

test('long inputs finish in linear time', () => {
  const inputs = [' 1234567890'.repeat(18_000), '-'.repeat(100_000), '9'.repeat(200_000), '1-1-1-1-1x'.repeat(20_000)];
  for (const t of inputs) {
    const a = Date.now();
    redactNumbers(t);
    hasNumberRun(t);
    assert.ok(Date.now() - a < 1000);
  }
});
