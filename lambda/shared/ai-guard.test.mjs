// node --test lambda/shared/ai-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardAi, aiEnabled } from './ai-guard.mjs';

function fakeClient() {
  const c = { calls: 0 };
  c.send = async () => { c.calls += 1; return 'sent'; };
  return c;
}

for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes', ' true']) {
  test(`AI stays off when AI_CALLS_ENABLED is ${JSON.stringify(value)}`, async () => {
    if (value === undefined) delete process.env.AI_CALLS_ENABLED; else process.env.AI_CALLS_ENABLED = value;
    const c = guardAi(fakeClient(), 'bedrock');
    assert.equal(aiEnabled(), false);
    await assert.rejects(c.send({}), (e) => e.aiDisabled === true && e.name === 'AiDisabledError');
    assert.equal(c.calls, 0, 'the real send must never run');
  });
}

test('AI runs only when AI_CALLS_ENABLED is exactly "true"', async () => {
  process.env.AI_CALLS_ENABLED = 'true';
  const c = guardAi(fakeClient(), 'bedrock');
  assert.equal(await c.send({}), 'sent');
  assert.equal(c.calls, 1);
  delete process.env.AI_CALLS_ENABLED;
});
