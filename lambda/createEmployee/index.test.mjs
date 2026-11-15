/**
 * BE-15: createEmployee settings tests (AC-2, AC-3).
 * Fakes only: no AWS call, no email, no AI.
 */
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

const cognitoCalls = [];


jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: jest.fn(async (c) => (c._type === 'Query' ? { Count: 0, Items: [] } : {})) })),
  PutItemCommand: jest.fn((a) => ({ _type: 'Put', ...a })),
  QueryCommand: jest.fn((a) => ({ _type: 'Query', ...a })),
  GetItemCommand: jest.fn((a) => ({ _type: 'Get', ...a })),
}));
jest.unstable_mockModule('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: jest.fn(async () => ({})) })),
  StartExecutionCommand: jest.fn((a) => a),
}));
jest.unstable_mockModule('@aws-sdk/client-kms', () => ({
  KMSClient: jest.fn(() => ({ send: jest.fn(async () => ({})) })),
  EncryptCommand: jest.fn((a) => a),
}));
jest.unstable_mockModule('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(() => ({ send: jest.fn(async () => ({})) })),
  PutEventsCommand: jest.fn((a) => a),
}));
jest.unstable_mockModule('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({
    send: jest.fn(async (c) => { cognitoCalls.push(c); return {}; }),
  })),
  AdminCreateUserCommand: jest.fn((a) => ({ _type: 'AdminCreateUser', ...a })),
  AdminSetUserPasswordCommand: jest.fn((a) => ({ _type: 'AdminSetUserPassword', ...a })),
  AdminAddUserToGroupCommand: jest.fn((a) => ({ _type: 'AdminAddUserToGroup', ...a })),
  ListUsersInGroupCommand: jest.fn((a) => ({ _type: 'ListUsersInGroup', ...a })),
}));

const SETTINGS = {
  COGNITO_POOL_ID: 'test-pool-1',
  LOGIN_URL: 'http://localhost:4300/sign-in',
  POSTMARK_SENDER_EMAIL: 'sender@example.test',
};
const SAVED = { ...process.env };

function applySettings(overrides = {}) {
  for (const k of Object.keys(SETTINGS)) delete process.env[k];
  delete process.env.POSTMARK_API_TOKEN; // no email client in tests
  delete process.env.KMS_KEY_ARN;
  delete process.env.SFN_STATE_MACHINE_ARN;
  delete process.env.IDEMPOTENCY_TABLE;
  Object.assign(process.env, SETTINGS, overrides);
}

beforeEach(() => {
  cognitoCalls.length = 0;
  jest.resetModules();
});
afterEach(() => {
  process.env = { ...SAVED };
  jest.restoreAllMocks();
});

describe('AC-2 a missing setting stops createEmployee at start', () => {
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

describe('AC-3 createEmployee uses its own pool', () => {
  test('create, set password and add to group all carry COGNITO_POOL_ID', async () => {
    applySettings();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const { handler } = await import('./index.mjs');
    const res = await handler({
      headers: {},
      // ONB-03: only HR may add an employee
      requestContext: { authorizer: { jwt: { claims: { 'cognito:groups': '[hr_staff]', 'custom:staff_id': 'HR1' } } } },
      body: JSON.stringify({
        first_name: 'John', last_name: 'Doe', email: 'e2e.run-1@example.test',
        phone: '0820000000', department: 'Bakery',
      }),
    });
    expect(res.statusCode).toBe(201);
    expect(cognitoCalls.map((c) => c._type)).toEqual(['AdminCreateUser', 'AdminSetUserPassword', 'AdminAddUserToGroup']);
    for (const c of cognitoCalls) expect(c.UserPoolId).toBe('test-pool-1');
    expect(cognitoCalls[2].GroupName).toBe('employee');
    expect(JSON.stringify(cognitoCalls)).not.toContain('af-south-1_2LdAGFnw2');
  });
});
