// node --test lambda/shared/ai-guard.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardAi, markRobot, isRobotCaller, isRobotEmail } from './ai-guard.mjs';

function fakeClient() {
  const c = { calls: 0 };
  c.send = async () => { c.calls += 1; return 'sent'; };
  return c;
}

test('robots are recognised by group or test-only email', () => {
  assert.equal(isRobotCaller({ 'cognito:groups': ['hr_staff', 'e2e-robots'] }), true);
  assert.equal(isRobotCaller({ 'cognito:groups': '[hr_staff e2e-robots]' }), true);
  assert.equal(isRobotCaller({ email: 'pepla-e2e-hr@blackhole.postmarkapp.com' }), true);
  assert.equal(isRobotCaller({ username: 'Pepla-E2E-HR@Blackhole.Postmarkapp.com' }), true);
  assert.equal(isRobotEmail('e2e.run-1-2@blackhole.postmarkapp.com'), true);
});

test('real people are not robots', () => {
  assert.equal(isRobotCaller({ 'cognito:groups': ['hr_staff'], email: 'thandi@company.co.za' }), false);
  assert.equal(isRobotCaller({}), false);
  assert.equal(isRobotCaller(undefined), false);
  assert.equal(isRobotEmail('someone@blackhole.postmarkapp.com.evil.com'), false);
});

test('a robot request never reaches the real AI call', async () => {
  delete process.env.AI_CALLS_ENABLED;
  const c = guardAi(fakeClient(), 'bedrock');
  markRobot(true);
  await assert.rejects(c.send({}), (e) => e.aiBlocked === true);
  assert.equal(c.calls, 0);
  markRobot(false);
});

test('a person gets the AI as today (switch unset)', async () => {
  delete process.env.AI_CALLS_ENABLED;
  const c = guardAi(fakeClient(), 'bedrock');
  markRobot(false);
  assert.equal(await c.send({}), 'sent');
  assert.equal(c.calls, 1);
});

test('the emergency switch "false" blocks everyone', async () => {
  process.env.AI_CALLS_ENABLED = 'false';
  const c = guardAi(fakeClient(), 'textract');
  markRobot(false);
  await assert.rejects(c.send({}), (e) => e.aiBlocked === true);
  assert.equal(c.calls, 0);
  delete process.env.AI_CALLS_ENABLED;
});
