/**
 * Tests for talentFlowRotateApiKey (NH-132)
 *
 * ESM Jest pattern (Lesson 12):
 *   - import { jest, ... } from '@jest/globals'
 *   - jest.unstable_mockModule before dynamic import of handler
 *   - mockReset() in beforeEach
 *   - each test sets its own mock return values
 */

import { jest, describe, test, expect, beforeEach } from '@jest/globals';

// ─── Mock @aws-sdk/client-secrets-manager ──────────────────────────────────

const mockSmSend = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSmSend })),
  PutSecretValueCommand: jest.fn((input) => ({ _input: input })),
}));

// ─── Load handler after mocks are in place ─────────────────────────────────

const { handler } = await import('./index.mjs');

// ─── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_ENV = { AGENT_API_KEY_SECRET_NAME: 'talent-flow/agent/api-key' };

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return fn().finally(restore);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('talentFlowRotateApiKey', () => {
  beforeEach(() => {
    mockSmSend.mockReset();
  });

  test('success — rotates key and returns rotatedAt + nextRotationAt', async () => {
    mockSmSend.mockResolvedValueOnce({});

    const result = await withEnv(DEFAULT_ENV, () => handler({}));

    // Response shape
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.rotatedAt).toBeDefined();
    expect(body.nextRotationAt).toBeDefined();

    // nextRotationAt should be ~90 days after rotatedAt
    const diff = new Date(body.nextRotationAt) - new Date(body.rotatedAt);
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    expect(diff).toBeGreaterThanOrEqual(ninetyDaysMs - 1000); // allow 1s tolerance
    expect(diff).toBeLessThanOrEqual(ninetyDaysMs + 1000);

    // PutSecretValueCommand called with correct secret name
    const { PutSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
    const callArgs = PutSecretValueCommand.mock.calls[0][0];
    expect(callArgs.SecretId).toBe('talent-flow/agent/api-key');

    // Key starts with 'tf-' and is 67 chars ('tf-' + 64 hex chars)
    expect(callArgs.SecretString).toMatch(/^tf-[0-9a-f]{64}$/);
  });

  test('success — key value is different on each invocation', async () => {
    mockSmSend.mockResolvedValue({});

    const { PutSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');

    await withEnv(DEFAULT_ENV, () => handler({}));
    const key1 = PutSecretValueCommand.mock.calls[0][0].SecretString;

    PutSecretValueCommand.mockClear();
    await withEnv(DEFAULT_ENV, () => handler({}));
    const key2 = PutSecretValueCommand.mock.calls[0][0].SecretString;

    expect(key1).not.toBe(key2);
  });

  test('missing env var — throws before calling SM', async () => {
    const saved = process.env.AGENT_API_KEY_SECRET_NAME;
    delete process.env.AGENT_API_KEY_SECRET_NAME;

    await expect(handler({})).rejects.toThrow(
      'AGENT_API_KEY_SECRET_NAME environment variable is not set',
    );
    expect(mockSmSend).not.toHaveBeenCalled();

    if (saved !== undefined) process.env.AGENT_API_KEY_SECRET_NAME = saved;
  });

  test('SM PutSecretValue failure — propagates error', async () => {
    mockSmSend.mockRejectedValueOnce(new Error('SecretsManagerThrottling'));

    await expect(withEnv(DEFAULT_ENV, () => handler({}))).rejects.toThrow(
      'SecretsManagerThrottling',
    );
  });

  test('pass-through event shape — EventBridge wrapper ignored gracefully', async () => {
    mockSmSend.mockResolvedValueOnce({});

    const ebEvent = {
      version: '0',
      id: 'abc123',
      source: 'aws.events',
      'detail-type': 'Scheduled Event',
      detail: {},
    };

    const result = await withEnv(DEFAULT_ENV, () => handler(ebEvent));
    expect(result.statusCode).toBe(200);
  });
});
