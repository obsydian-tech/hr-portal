/**
 * BE-15: sendNotificationEmail settings tests (AC-2). Fakes only.
 */
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: jest.fn(async () => ({})) })),
  GetItemCommand: jest.fn((a) => a),
  QueryCommand: jest.fn((a) => a),
}));

const SETTINGS = {
  HR_EMAIL: 'hr@example.test',
  POSTMARK_SENDER_EMAIL: 'sender@example.test',
  LOGIN_URL: 'http://localhost:4300/sign-in',
};
const SAVED = { ...process.env };

function applySettings(overrides = {}) {
  for (const k of Object.keys(SETTINGS)) delete process.env[k];
  Object.assign(process.env, SETTINGS, overrides);
}

beforeEach(() => jest.resetModules());
afterEach(() => {
  process.env = { ...SAVED };
  jest.restoreAllMocks();
});

describe('AC-2 a missing setting stops sendNotificationEmail at start', () => {
  for (const name of Object.keys(SETTINGS)) {
    test(`${name} unset: load throws "Missing setting ${name}" and logs one line`, async () => {
      applySettings();
      delete process.env[name];
      const err = jest.spyOn(console, 'error').mockImplementation(() => {});
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      await expect(import('./index.mjs')).rejects.toThrow(`Missing setting ${name}`);
      expect(err).toHaveBeenCalledTimes(1);
      expect(err).toHaveBeenCalledWith(`Missing setting ${name}`);
      expect(log).not.toHaveBeenCalled();
    });

    test(`${name} empty: load throws`, async () => {
      applySettings({ [name]: '' });
      jest.spyOn(console, 'error').mockImplementation(() => {});
      await expect(import('./index.mjs')).rejects.toThrow(`Missing setting ${name}`);
    });
  }

  test('all settings present: loads', async () => {
    applySettings();
    const mod = await import('./index.mjs');
    expect(typeof mod.handler).toBe('function');
  });
});
