/**
 * BE-15: sendTalentFlowNotification settings tests (AC-2). Fakes only: nothing here calls AWS.
 * A setting that names one environment has no fallback; a missing one stops
 * the Lambda when it loads, with one log line.
 */
'use strict';

jest.mock('../shared/config-reader', () => ({ getConfig: jest.fn() }));

const SETTINGS = {
  'POSTMARK_SENDER_EMAIL': 'sender@example.test'
};
const SAVED = { ...process.env };

function applySettings(overrides = {}) {
  for (const k of Object.keys(SETTINGS)) delete process.env[k];
  Object.assign(process.env, SETTINGS, overrides);
}

function load() {
  let mod;
  jest.isolateModules(() => {
    mod = require('./index');
  });
  return mod;
}

afterEach(() => {
  process.env = { ...SAVED };
  jest.restoreAllMocks();
});

// MOD-01: the module switch is the shared helper's job (tested in shared/modules.test.mjs); here Recruitment is on.
jest.unstable_mockModule('../shared/modules.mjs', () => ({
  MODULE_KEYS: ['onboarding', 'recruitment'],
  modulesOf: async () => ['onboarding', 'recruitment'],
  requireModule: async () => null,
}));

describe('AC-2 a missing setting stops sendTalentFlowNotification at start', () => {
  for (const name of Object.keys(SETTINGS)) {
    test(`${name} unset: load throws "Missing setting ${name}" and logs one line`, () => {
      applySettings();
      delete process.env[name];
      const err = jest.spyOn(console, 'error').mockImplementation(() => {});
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      expect(() => load()).toThrow(`Missing setting ${name}`);
      expect(err).toHaveBeenCalledTimes(1);
      expect(err).toHaveBeenCalledWith(`Missing setting ${name}`);
      expect(log).not.toHaveBeenCalled();
    });

    test(`${name} empty: load throws`, () => {
      applySettings({ [name]: '' });
      jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => load()).toThrow(`Missing setting ${name}`);
    });
  }

  test('all settings present: loads', () => {
    applySettings();
    const mod = load();
    expect(typeof mod.handler).toBe('function');
  });
});
