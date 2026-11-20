/**
 * BE-15: createEmployee settings tests (AC-2, AC-3).
 * Fakes only: no AWS call, no email, no AI.
 */
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';

const cognitoCalls = [];
const dynamoCalls = [];


jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: jest.fn(async (c) => { dynamoCalls.push(c); return c._type === 'Query' ? { Count: 0, Items: [] } : {}; }) })),
  PutItemCommand: jest.fn((a) => ({ _type: 'Put', ...a })),
  UpdateItemCommand: jest.fn((a) => ({ _type: 'Update', ...a })),
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
    send: jest.fn(async (c) => {
      cognitoCalls.push(c);
      // Cognito answers a new user with its sub; the invite stores it as the company member.
      if (c._type === 'AdminCreateUser') return { User: { Username: 'user-1', Attributes: [{ Name: 'sub', Value: 'sub-user-1' }] } };
      return {};
    }),
  })),
  AdminCreateUserCommand: jest.fn((a) => ({ _type: 'AdminCreateUser', ...a })),
  AdminSetUserPasswordCommand: jest.fn((a) => ({ _type: 'AdminSetUserPassword', ...a })),
  AdminAddUserToGroupCommand: jest.fn((a) => ({ _type: 'AdminAddUserToGroup', ...a })),
  ListUsersInGroupCommand: jest.fn((a) => ({ _type: 'ListUsersInGroup', ...a })),
  AdminGetUserCommand: jest.fn((a) => ({ _type: 'AdminGetUser', ...a })),
  AdminListGroupsForUserCommand: jest.fn((a) => ({ _type: 'AdminListGroupsForUser', ...a })),
}));

// TEN-02: the shared company membership module keeps its own AWS client, so it is faked whole here.
jest.unstable_mockModule('../shared/membership.mjs', () => ({
  addMember: jest.fn(async () => {}),
  companiesOf: jest.fn(async () => []),
  companyOfSignIn: jest.fn(async () => ''),
  inCompany: jest.fn(async (users) => users),
}));

const SETTINGS = {
  COGNITO_POOL_ID: 'test-pool-1',
  LOGIN_URL: 'http://localhost:4300/sign-in',
  POSTMARK_SENDER_EMAIL: 'sender@example.test',
  COMPANY_NAME: 'Test Bakery',
  APP_URL: 'http://localhost:4300',
};
const SAVED = { ...process.env };

function applySettings(overrides = {}) {
  for (const k of Object.keys(SETTINGS)) delete process.env[k];
  delete process.env.POSTMARK_API_TOKEN; // no email client in tests
  delete process.env.KMS_KEY_ARN;
  delete process.env.SFN_STATE_MACHINE_ARN;
  delete process.env.IDEMPOTENCY_TABLE;
  process.env.TENANTS_TABLE = 'tenants-test'; // TEN-02: where the new sign-in's company membership is written
  process.env.LEGACY_TENANT_ID = '';
  Object.assign(process.env, SETTINGS, overrides);
}

beforeEach(() => {
  cognitoCalls.length = 0;
  dynamoCalls.length = 0;
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
  test('create and add to group both carry COGNITO_POOL_ID (ONB-04: no password is set)', async () => {
    applySettings();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const { handler } = await import('./index.mjs');
    const res = await handler({
      headers: {},
      // ONB-03: only HR may add an employee
      requestContext: { authorizer: { jwt: { claims: { 'cognito:groups': '[hr_staff]', 'custom:staff_id': 'HR1', tenant_id: 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa' } } } },
      body: JSON.stringify({
        first_name: 'John', last_name: 'Doe', email: 'e2e.run-1@example.test',
        phone: '0820000000', department: 'Bakery',
      }),
    });
    expect(res.statusCode).toBe(201);
    expect(cognitoCalls.map((c) => c._type)).toEqual(['AdminCreateUser', 'AdminAddUserToGroup']);
    for (const c of cognitoCalls) expect(c.UserPoolId).toBe('test-pool-1');
    expect(cognitoCalls[1].GroupName).toBe('employee');
    expect(JSON.stringify(cognitoCalls)).not.toContain('af-south-1_2LdAGFnw2');
  });
});

describe('ONB-11 the owner link (user_sub) is written only on the caller\'s own company row', () => {
  const COMPANY_A = 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa';
  const COMPANY_B = 'ten_bbbbbbbbbbbbbbbbbbbbbbbbbb';
  const add = async (tenant, extraBody = {}) => {
    applySettings();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'info').mockImplementation(() => {});
    const { handler } = await import('./index.mjs');
    const res = await handler({
      headers: {},
      requestContext: { authorizer: { jwt: { claims: { 'cognito:groups': '[hr_staff]', 'custom:staff_id': 'HR1', tenant_id: tenant } } } },
      body: JSON.stringify({ first_name: 'Thandi', last_name: 'Dube', email: `e2e.owner-${tenant}@example.test`, phone: '0820000000', department: 'Bakery', ...extraBody }),
    });
    expect(res.statusCode).toBe(201);
    const put = dynamoCalls.find((c) => c._type === 'Put' && c.Item?.employee_id && c.Item?.tenant_id);
    const links = dynamoCalls.filter((c) => c._type === 'Update' && c.TableName === 'employees' && /user_sub/.test(c.UpdateExpression ?? ''));
    return { put, links };
  };

  test('company B\'s HR: one update, on the new row only, and it must be company B\'s row', async () => {
    const { put, links } = await add(COMPANY_B);
    expect(links).toHaveLength(1);
    expect(links[0].Key).toEqual({ employee_id: put.Item.employee_id });
    expect(links[0].ConditionExpression).toBe('#tenant_id = :tenant_id');
    expect(links[0].ExpressionAttributeValues[':tenant_id']).toEqual({ S: COMPANY_B });
    expect(JSON.stringify(links[0])).not.toContain(COMPANY_A);
    expect(links[0].ExpressionAttributeValues[':sub']).toEqual({ S: 'sub-user-1' });
  });

  test('the company comes from the sign-in, never from the request body', async () => {
    const { links } = await add(COMPANY_B, { tenant_id: COMPANY_A, tenantId: COMPANY_A, company: COMPANY_A });
    expect(links).toHaveLength(1);
    expect(links[0].ExpressionAttributeValues[':tenant_id']).toEqual({ S: COMPANY_B });
  });

  test('company A and company B each link only their own new row', async () => {
    const a = await add(COMPANY_A);
    dynamoCalls.length = 0;
    jest.resetModules();
    const b = await add(COMPANY_B);
    expect(a.links[0].ExpressionAttributeValues[':tenant_id']).toEqual({ S: COMPANY_A });
    expect(b.links[0].ExpressionAttributeValues[':tenant_id']).toEqual({ S: COMPANY_B });
    expect(a.links[0].Key.employee_id).not.toEqual(b.links[0].Key.employee_id);
  });
});
