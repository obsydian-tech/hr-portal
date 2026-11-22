'use strict';

/**
 * lambda/manageTalentFlowConfig/index.test.js
 *
 * Tests covering NH-120 checklist:
 *  GET:
 *   1. Returns all versions when ?active not set
 *   2. Returns active item only when ?active=true
 *   3. 404 when no active item found on ?active=true
 *   4. 400 when configType query param missing
 *  POST:
 *   5. Creates v1, returns 201 with version=1
 *   6. 403 when non-admin calls POST
 *   7. 400 when configType missing from POST body
 *   8. 409 when active version already exists
 *  PUT:
 *   9. Writes new version N+1 (PutItem) AND deactivates old version (UpdateItem with TTL)
 *  10. 403 when non-admin calls PUT
 *  11. 404 when no active version exists for PUT
 *  12. 400 when data missing from PUT body
 *  13. Old version is never deleted — only UpdateItem (TTL + isActive=false)
 *  14. Unknown HTTP method returns 405
 */

process.env.CONFIG_TABLE_NAME = 'talent-flow-config';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  QueryCommand:       jest.fn(p => ({ _cmd: 'Query',      ...p })),
  PutItemCommand:     jest.fn(p => ({ _cmd: 'PutItem',    ...p })),
  UpdateItemCommand:  jest.fn(p => ({ _cmd: 'UpdateItem', ...p }))
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall:   jest.fn(obj => obj),
  unmarshall: jest.fn(obj => obj)
}));

const TEN = 'ten_0123456789abcdefghijklmnop';

const { handler } = require('./index');

beforeEach(() => mockSend.mockReset());

// ── Helpers ───────────────────────────────────────────────────────────────────

function adminEvent(method, extra = {}) {
  return {
    requestContext: {
      http: { method },
      authorizer: { jwt: { claims: { 'custom:isAdmin': 'true', tenant_id: TEN } } }
    },
    ...extra
  };
}

function nonAdminEvent(method, extra = {}) {
  return {
    requestContext: {
      http: { method },
      authorizer: { jwt: { claims: { 'custom:isAdmin': 'false', tenant_id: TEN } } }
    },
    ...extra
  };
}

const activeItem = {
  PK: `TENANT#${TEN}`, SK: 'CONFIG#SCORING_WEIGHTS#v2',
  GSI1PK: `TENANT#${TEN}#ACTIVE`, GSI1SK: 'CONFIG#SCORING_WEIGHTS',
  tenant_id: TEN, configType: 'SCORING_WEIGHTS', version: 2, isActive: true,
  data: { technical: 30 }
};

// ── GET tests ─────────────────────────────────────────────────────────────────

// MOD-01: the module switch is the shared helper's job (tested in shared/modules.test.mjs); here Recruitment is on.
jest.unstable_mockModule('../shared/modules.mjs', () => ({
  MODULE_KEYS: ['onboarding', 'recruitment'],
  modulesOf: async () => ['onboarding', 'recruitment'],
  requireModule: async () => null,
}));

// REC-01: Recruitment settings are read by a Recruiter (HR with the Recruitment tick) or an admin; nobody else.
const asGroups = (groups) => ({
  requestContext: { http: { method: 'GET' }, authorizer: { jwt: { claims: { tenant_id: TEN, ...(groups ? { 'cognito:groups': groups } : {}) } } } },
  queryStringParameters: { configType: 'SCORING_WEIGHTS', active: 'true' },
});

test('REC-01 GET: a Recruiter and an admin read; every other caller gets 403 before any AWS call', async () => {
  for (const groups of ['[hr_staff]', '[perm-recruitment]', '[manager]', '[employee]', '[guest]', '[perm-approve-offers]', undefined]) {
    const res = await handler(asGroups(groups));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: 'Forbidden' });
  }
  expect(mockSend).not.toHaveBeenCalled();
  for (const groups of ['[hr_staff perm-recruitment]', '[admin]']) {
    mockSend.mockResolvedValueOnce({ Items: [activeItem] });
    expect((await handler(asGroups(groups))).statusCode).toBe(200);
  }
});

test('GET: returns all versions when ?active not set', async () => {
  const items = [
    { ...activeItem, version: 1, isActive: false },
    { ...activeItem, version: 2, isActive: true }
  ];
  mockSend.mockResolvedValueOnce({ Items: items });

  const event = adminEvent('GET', { queryStringParameters: { configType: 'SCORING_WEIGHTS' } });
  const res = await handler(event);

  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.count).toBe(2);
  expect(body.items).toHaveLength(2);
});

test('GET: returns active item only when ?active=true', async () => {
  mockSend.mockResolvedValueOnce({ Items: [activeItem] });

  const event = adminEvent('GET', { queryStringParameters: { configType: 'SCORING_WEIGHTS', active: 'true' } });
  const res = await handler(event);

  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.version).toBe(2);
});

test('GET: 200 with an empty config when no active item found', async () => {
  // The admin UI treats a missing config as "not yet configured", not an error.
  mockSend.mockResolvedValueOnce({ Items: [] });

  const event = adminEvent('GET', { queryStringParameters: { configType: 'SCORING_WEIGHTS', active: 'true' } });
  const res = await handler(event);

  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body).toMatchObject({ configType: 'SCORING_WEIGHTS', version: null, isActive: false, data: {} });
});

test('GET: 400 when configType query param missing', async () => {
  const event = adminEvent('GET', { queryStringParameters: {} });
  const res = await handler(event);

  expect(res.statusCode).toBe(400);
  expect(JSON.parse(res.body).error).toMatch(/configType/);
});

// ── POST tests ────────────────────────────────────────────────────────────────

test('POST: creates v1, returns 201 with version=1', async () => {
  // getActiveItem → no existing active version
  mockSend.mockResolvedValueOnce({ Items: [] });
  // PutItem → success
  mockSend.mockResolvedValueOnce({});
  mockSend.mockResolvedValueOnce({}); // audit row

  const event = adminEvent('POST', {
    body: JSON.stringify({ configType: 'WORKFLOW_TEMPLATES', data: { technical: 30 } })
  });
  const res = await handler(event);

  expect(res.statusCode).toBe(201);
  const body = JSON.parse(res.body);
  expect(body.version).toBe(1);
  expect(mockSend).toHaveBeenCalledTimes(3); // Query + PutItem + audit row
});

test('POST: 403 when non-admin', async () => {
  const event = nonAdminEvent('POST', {
    body: JSON.stringify({ configType: 'WORKFLOW_TEMPLATES', data: {} })
  });
  const res = await handler(event);

  expect(res.statusCode).toBe(403);
  // DynamoDB should NOT be called — guard must fire before any DB operation
  expect(mockSend).not.toHaveBeenCalled();
});

test('POST: 400 when configType missing', async () => {
  const event = adminEvent('POST', { body: JSON.stringify({ data: {} }) });
  const res = await handler(event);

  expect(res.statusCode).toBe(400);
  expect(mockSend).not.toHaveBeenCalled();
});

test('POST: 409 when active version already exists', async () => {
  mockSend.mockResolvedValueOnce({ Items: [activeItem] });

  const event = adminEvent('POST', {
    body: JSON.stringify({ configType: 'WORKFLOW_TEMPLATES', data: { technical: 30 } })
  });
  const res = await handler(event);

  expect(res.statusCode).toBe(409);
  // Should only have made the getActiveItem Query — no PutItem
  expect(mockSend).toHaveBeenCalledTimes(1);
});

// ── PUT tests ─────────────────────────────────────────────────────────────────

test('PUT: writes N+1 via PutItem AND deactivates N via UpdateItem', async () => {
  // getActiveItem → returns version 2
  mockSend.mockResolvedValueOnce({ Items: [activeItem] });
  // PutItem new version
  mockSend.mockResolvedValueOnce({});
  // UpdateItem old version
  mockSend.mockResolvedValueOnce({});
  // audit row
  mockSend.mockResolvedValueOnce({});

  const event = adminEvent('PUT', {
    body: JSON.stringify({ configType: 'WORKFLOW_TEMPLATES', data: { technical: 40 } })
  });
  const res = await handler(event);

  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.version).toBe(3);
  expect(body.previousVersion).toBe(2);
  expect(mockSend).toHaveBeenCalledTimes(4); // Query + PutItem + UpdateItem + audit row
});

test('PUT: 403 when non-admin', async () => {
  const event = nonAdminEvent('PUT', {
    body: JSON.stringify({ configType: 'WORKFLOW_TEMPLATES', data: {} })
  });
  const res = await handler(event);

  expect(res.statusCode).toBe(403);
  expect(mockSend).not.toHaveBeenCalled();
});

test('PUT: creates v1 when no active version exists (upsert)', async () => {
  mockSend
    .mockResolvedValueOnce({ Items: [] }) // getActiveItem Query
    .mockResolvedValueOnce({})            // PutItem v1
    .mockResolvedValueOnce({});           // audit row

  const event = adminEvent('PUT', {
    body: JSON.stringify({ configType: 'WORKFLOW_TEMPLATES', data: { technical: 40 } })
  });
  const res = await handler(event);

  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.body)).toMatchObject({ configType: 'WORKFLOW_TEMPLATES', version: 1, data: { technical: 40 } });
  expect(mockSend).toHaveBeenCalledTimes(3);
  const put = mockSend.mock.calls[1][0];
  expect(put.ConditionExpression).toBe('attribute_not_exists(PK)');
});

test('PUT: 400 when data missing', async () => {
  const event = adminEvent('PUT', { body: JSON.stringify({ configType: 'WORKFLOW_TEMPLATES' }) });
  const res = await handler(event);

  expect(res.statusCode).toBe(400);
  expect(mockSend).not.toHaveBeenCalled();
});

test('PUT: old version UpdateItem sets isActive=false, keeps the version for good (no expiry) and never deletes', async () => {
  mockSend.mockResolvedValueOnce({ Items: [activeItem] });
  mockSend.mockResolvedValueOnce({});
  mockSend.mockResolvedValueOnce({});
  mockSend.mockResolvedValueOnce({}); // audit row

  const event = adminEvent('PUT', {
    body: JSON.stringify({ configType: 'WORKFLOW_TEMPLATES', data: { technical: 40 } })
  });
  await handler(event);

  // Third call (index 2) is the UpdateItem for the old version
  const updateCall = mockSend.mock.calls[2][0];
  expect(updateCall._cmd).toBe('UpdateItem');
  expect(updateCall.UpdateExpression).not.toContain('expiresAt'); // REC-12 D-T-10: a candidate may be locked to this version
  expect(updateCall.UpdateExpression).toContain('isActive');
  expect(updateCall.UpdateExpression).toContain('REMOVE GSI1PK');
});

// ── Method routing ────────────────────────────────────────────────────────────

test('unknown HTTP method returns 405', async () => {
  const event = adminEvent('DELETE', {});
  const res = await handler(event);

  expect(res.statusCode).toBe(405);
});
