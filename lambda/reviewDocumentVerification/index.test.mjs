/**
 * BE-15: reviewDocumentVerification settings tests (AC-2). Fakes only.
 */
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: jest.fn(async () => ({})) })),
  ScanCommand: jest.fn((a) => a),
  UpdateItemCommand: jest.fn((a) => a),
  QueryCommand: jest.fn((a) => a),
  GetItemCommand: jest.fn((a) => a),
}));
jest.unstable_mockModule('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: jest.fn(() => ({ send: jest.fn(async () => ({})) })),
  PutMetricDataCommand: jest.fn((a) => a),
}));
jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: jest.fn(async () => ({})) })),
  PutEventsCommand: jest.fn((a) => a),
}));
jest.unstable_mockModule('../shared/idempotency.mjs', () => ({
  withIdempotency: jest.fn(async (_key, fn) => fn()),
}));

const SAVED = { ...process.env };

beforeEach(() => jest.resetModules());
afterEach(() => {
  process.env = { ...SAVED };
  jest.restoreAllMocks();
});

describe('AC-2 a missing setting stops reviewDocumentVerification at start', () => {
  test('ENVIRONMENT unset: load throws "Missing setting ENVIRONMENT" and logs one line', async () => {
    delete process.env.ENVIRONMENT;
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(import('./index.mjs')).rejects.toThrow('Missing setting ENVIRONMENT');
    expect(err).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith('Missing setting ENVIRONMENT');
    expect(log).not.toHaveBeenCalled();
  });

  test('ENVIRONMENT empty: load throws', async () => {
    process.env.ENVIRONMENT = '';
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(import('./index.mjs')).rejects.toThrow('Missing setting ENVIRONMENT');
  });

  test('ENVIRONMENT set: loads', async () => {
    process.env.ENVIRONMENT = 'dev';
    const mod = await import('./index.mjs');
    expect(typeof mod.handler).toBe('function');
  });
});
