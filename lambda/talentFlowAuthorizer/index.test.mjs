import { jest, describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';

// -- Mock declarations (must precede dynamic import for ESM hoisting) ---------
const mockSmSend = jest.fn();

jest.unstable_mockModule('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSmSend })),
  GetSecretValueCommand: jest.fn((p) => ({ _cmd: 'GetSecretValue', ...p })),
}));

jest.unstable_mockModule('@aws-lambda-powertools/logger', () => ({
  Logger: jest.fn(() => ({
    info:  jest.fn(),
    warn:  jest.fn(),
    error: jest.fn(),
  })),
}));

// -- Import after mocks are registered ----------------------------------------
const { handler } = await import('./index.mjs');

// -- Constants ----------------------------------------------------------------
const VALID_KEY    = 'tf-abc123def456';
const VALID_KEY2   = 'tf-pending999';
const CACHE_TTL_MS = 4 * 60 * 1000; // must match module constant

function event(key) {
  return { headers: key === undefined ? {} : { 'x-api-key': key } };
}

// -- Suite --------------------------------------------------------------------
describe('talentFlowAuthorizer', () => {
  // Fake timers let us advance Date.now() to bust the 4-min in-process cache.
  beforeAll(() => { jest.useFakeTimers(); });
  afterAll(() => { jest.useRealTimers(); });

  beforeEach(() => {
    mockSmSend.mockReset(); // clears calls AND queued return values
    // Expire cache so every test starts with a cold SM fetch.
    jest.advanceTimersByTime(CACHE_TTL_MS + 1);
  });

  test('returns isAuthorized: false when x-api-key header is absent', async () => {
    const result = await handler(event(undefined));
    expect(result).toEqual({ isAuthorized: false });
    expect(mockSmSend).not.toHaveBeenCalled();
  });

  test('returns isAuthorized: true with actor=AGENT for valid AWSCURRENT key', async () => {
    mockSmSend
      .mockResolvedValueOnce({ SecretString: VALID_KEY })
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }));
    const result = await handler(event(VALID_KEY));
    expect(result).toEqual({ isAuthorized: true, context: { actor: 'AGENT' } });
  });

  test('returns isAuthorized: false for wrong key', async () => {
    mockSmSend
      .mockResolvedValueOnce({ SecretString: VALID_KEY })
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }));
    const result = await handler(event('wrong-key'));
    expect(result).toEqual({ isAuthorized: false });
  });

  test('accepts AWSPENDING key during active key rotation', async () => {
    mockSmSend
      .mockResolvedValueOnce({ SecretString: VALID_KEY })
      .mockResolvedValueOnce({ SecretString: VALID_KEY2 });
    const result = await handler(event(VALID_KEY2));
    expect(result).toEqual({ isAuthorized: true, context: { actor: 'AGENT' } });
  });

  test('authorizes with AWSCURRENT when AWSPENDING fails with non-404 error', async () => {
    mockSmSend
      .mockResolvedValueOnce({ SecretString: VALID_KEY })
      .mockRejectedValueOnce(
        Object.assign(new Error('InternalFailure'), { name: 'InternalFailure' })
      );
    const result = await handler(event(VALID_KEY));
    expect(result).toEqual({ isAuthorized: true, context: { actor: 'AGENT' } });
  });

  test('returns isAuthorized: false when SM throws on AWSCURRENT fetch', async () => {
    mockSmSend.mockRejectedValueOnce(new Error('SM unavailable'));
    const result = await handler(event(VALID_KEY));
    expect(result).toEqual({ isAuthorized: false });
  });

  test('uses AGENT_API_KEY_SECRET_NAME env var when set', async () => {
    process.env.AGENT_API_KEY_SECRET_NAME = 'custom/secret/path';
    mockSmSend
      .mockResolvedValueOnce({ SecretString: VALID_KEY })
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }));
    await handler(event(VALID_KEY));
    expect(mockSmSend.mock.calls[0][0].SecretId).toBe('custom/secret/path');
    delete process.env.AGENT_API_KEY_SECRET_NAME;
  });

  test('defaults to talent-flow/agent/api-key when env var absent', async () => {
    const saved = process.env.AGENT_API_KEY_SECRET_NAME;
    delete process.env.AGENT_API_KEY_SECRET_NAME;
    mockSmSend
      .mockResolvedValueOnce({ SecretString: VALID_KEY })
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' }));
    await handler(event(VALID_KEY));
    expect(mockSmSend.mock.calls[0][0].SecretId).toBe('talent-flow/agent/api-key');
    if (saved !== undefined) process.env.AGENT_API_KEY_SECRET_NAME = saved;
  });
});
