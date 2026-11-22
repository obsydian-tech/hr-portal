// CHAT-08: the limits every answer block passes, fresh or read back from a stored chat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, limitBlocks, storedBlocks } from './answer-blocks.mjs';

const ID = '3f2b8c1e-4a5d-4e6f-9a0b-1c2d3e4f5a6b';

test('unknown kinds and broken blocks are dropped; at most 8 blocks', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ kind: 'text', text: `Line ${'x'.repeat(i)}` }));
  assert.equal(limitBlocks([{ kind: 'html', text: '<b>x</b>' }, null, 'text', ...many]).length, LIMITS.blocks);
  assert.deepEqual(limitBlocks('nope'), []);
});

test('ISO dates become words and number runs are removed', () => {
  const [b] = limitBlocks([{ kind: 'text', text: 'Starts 2026-09-14, ID 8001015009087.' }]);
  assert.match(b.text, /14 Sep 2026/);
  assert.doesNotMatch(b.text, /2026-09-14|8001015009087/);
});

test('a table keeps personId only for a UUID, cuts rows and cells', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ cells: { name: 'A'.repeat(200) }, personId: i ? 'EMP-0001' : ID }));
  const [t] = limitBlocks([{ kind: 'table', columns: [{ key: 'name', label: 'Employee' }], rows }]);
  assert.equal(t.rows.length, LIMITS.rows);
  assert.equal(t.rows[0].personId, ID);
  assert.equal(t.rows[1].personId, undefined);
  assert.ok(t.rows[0].cells.name.length <= LIMITS.cell);
});

test('a chart needs two bars with whole numbers and not all zero', () => {
  assert.deepEqual(limitBlocks([{ kind: 'chart', type: 'bar', title: 'T', bars: [{ label: 'a', value: 0 }, { label: 'b', value: 0 }] }]), []);
  assert.deepEqual(limitBlocks([{ kind: 'chart', type: 'bar', title: 'T', bars: [{ label: 'a', value: 1.5 }, { label: 'b', value: 2 }] }]), []);
  assert.equal(limitBlocks([{ kind: 'chart', type: 'bar', title: 'T', bars: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] }]).length, 1);
});

test('stored blocks over 20 KB keep only the text blocks', () => {
  const rows = Array.from({ length: 25 }, () => ({ cells: Object.fromEntries('abcde'.split('').map((k) => [k, 'w'.repeat(120)])) }));
  const table = { kind: 'table', columns: 'abcde'.split('').map((k) => ({ key: k, label: k })), rows };
  const kept = JSON.parse(storedBlocks([{ kind: 'text', text: 'One' }, table, table, { kind: 'text', text: 'Two' }]));
  assert.deepEqual(kept.map((b) => b.kind), ['text', 'text']);
  const small = JSON.parse(storedBlocks([{ kind: 'text', text: 'One' }, { kind: 'list', items: ['a', 'b'] }]));
  assert.equal(small.length, 2);
});
