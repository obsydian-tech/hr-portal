/**
 * CHAT-02: the chat store's pure parts, and the delete retry. The handlers are run against a fake AWS by the locked
 * acceptance test (pepla-web/e2e/acceptance/chat-02.spec.ts); these keep the small rules close to the code.
 * Run by `npm test` in lambda/shared.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOUNDING_DEFAULT, MODULE_KEYS, modulesOfRow } from './modules.mjs';
import { ChatNotDeleted, deleteKeys, isChatId, newChatId, ownerKey, redactToolOutputs, titleOf } from './ask-batsi-chats.mjs';

test('a chat id is a 26 character ULID, made here, and later ones sort after earlier ones', () => {
  const a = newChatId(1_700_000_000_000);
  const b = newChatId(1_700_000_001_000);
  assert.ok(isChatId(a) && isChatId(b));
  assert.ok(a < b);
  for (const bad of ['', 'abc', 'x'.repeat(26), undefined, null, 5, `${a}0`, a.toLowerCase()]) assert.equal(isChatId(bad), false);
});

test('the owner key holds the company and the person, nothing the caller typed', () => {
  assert.equal(ownerKey('ten_0123456789abcdefghijklmnop', 'STAFF-1'), 'T#ten_0123456789abcdefghijklmnop#S#STAFF-1');
});

test('a title is the first question with numbers taken out, one line, at most 80 characters', () => {
  assert.equal(titleOf('How many\n people   started?'), 'How many people started?');
  assert.ok(!/\d{6}/.test(titleOf('Check ID 8001015009087 for Sam')));
  const long = titleOf('word '.repeat(60));
  assert.ok(long.length <= 80);
  assert.match(long, /…$/);
});

test('the tool outputs of an audit record keep no run of six or more digits, at any depth', () => {
  const out = redactToolOutputs({
    'get_employee#0': {
      called_at: '2026-11-18T10:00:00.000Z',
      request: { id: 'EMP-1', phone: '082 123 4567' },
      response: { bank: { account: 1234567890 }, list: ['ID 8001015009087'], count: 3 },
      http_status: 200,
    },
  });
  const text = JSON.stringify(out);
  assert.ok(!/\d{6}/.test(text.replace('2026-11-18T10:00:00.000Z', '')), text);
  assert.equal(out['get_employee#0'].response.count, 3);
  assert.equal(out['get_employee#0'].http_status, 200);
  assert.deepEqual(redactToolOutputs(undefined), {});
});

test('Ask Batsi is a module key, and a founding company does not get it by default', () => {
  assert.ok(MODULE_KEYS.includes('ask_batsi'));
  assert.ok(!FOUNDING_DEFAULT.includes('ask_batsi'));
  assert.deepEqual([...FOUNDING_DEFAULT].sort(), ['onboarding', 'recruitment']);
  const founding = modulesOfRow({ pk: { S: 'TENANT#x' }, sk: { S: 'PROFILE' }, founding: { BOOL: true } });
  if (founding) assert.ok(!founding.includes('ask_batsi'));
});

test('deleting nothing never calls AWS', async () => {
  process.env.CHATS_TABLE = 'ask-batsi-chats';
  await deleteKeys([]);
  assert.equal(new ChatNotDeleted().name, 'ChatNotDeleted');
});
