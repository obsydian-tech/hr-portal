/**
 * BE-15: getPanelMembers settings tests (AC-2). Fakes only: nothing here calls AWS.
 * A setting that names one environment has no fallback; a missing one stops
 * the Lambda when it loads, with one log line.
 */
'use strict';

const SETTINGS = {
  'COGNITO_POOL_ID': 'test-pool-1'
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

describe('AC-2 a missing setting stops getPanelMembers at start', () => {
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
